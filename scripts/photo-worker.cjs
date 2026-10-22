// Run in a short-lived process: HEIC decode must not block the web server.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const exifr = require('exifr');
async function main() {
  const folder = process.argv[2], input = await fs.readFile(path.join(folder, 'original'));
  const heic = input.toString('ascii', 4, 8) === 'ftyp' && /heic|heix|hevc|hevx|mif1|msf1/.test(input.toString('ascii', 8, 40));
  let exif = {};
  try { exif = await exifr.parse(input, { reviveValues: false, xmp: false, iptc: false, icc: false }) || {}; } catch {}
  let image, width, height, mime;
  if (heic) {
    const libheif = require('libheif-js/wasm-bundle');
    const decoder = new libheif.HeifDecoder(), images = decoder.decode(input), first = images[0];
    if (!first) throw new Error('HEIC cannot be decoded');
    width = first.get_width(); height = first.get_height();
    if (!(width > 0 && height > 0) || width * height > 80_000_000) throw new Error('Pixel limit exceeded');
    const result = await new Promise((resolve, reject) => first.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, data => data ? resolve(data) : reject(new Error('HEIC decode failed'))));
    image = sharp(Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength), { raw: { width, height, channels: 4 }, limitInputPixels: 80_000_000 });
    mime = 'image/heic';
    images.forEach(img => img.free?.());
  } else {
    image = sharp(input, { limitInputPixels: 80_000_000, failOn: 'error' });
    const meta = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) throw new Error('Unsupported still image');
    width = meta.width; height = meta.height;
    if (meta.orientation >= 5) [width, height] = [height, width];
    mime = `image/${meta.format}`;
    image = image.rotate();
  }
  image = image.toColourspace('srgb');
  await image.clone().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toFile(path.join(folder, 'display.webp'));
  await image.clone().resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(folder, 'thumb.webp'));
  const metadata = {
    capturedAt: typeof exif.DateTimeOriginal === 'string' ? exif.DateTimeOriginal : null,
    offset: typeof exif.OffsetTimeOriginal === 'string' && /^[+-]\d{2}:\d{2}$/.test(exif.OffsetTimeOriginal) ? exif.OffsetTimeOriginal : null,
    latitude: typeof exif.latitude === 'number' && Number.isFinite(exif.latitude) && Math.abs(exif.latitude) <= 90 ? exif.latitude : null,
    longitude: typeof exif.longitude === 'number' && Number.isFinite(exif.longitude) && Math.abs(exif.longitude) <= 180 ? exif.longitude : null,
  };
  if (metadata.latitude === null || metadata.longitude === null) metadata.latitude = metadata.longitude = null;
  await fs.writeFile(path.join(folder, 'metadata.json'), JSON.stringify({ width, height, mime, metadata }));
}
main().catch(() => { process.exitCode = 1; });
