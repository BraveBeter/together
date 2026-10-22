import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile(new URL("../src/app/icon.svg", import.meta.url));
const sizes = [16, 32, 48, 64];
const images = await Promise.all(sizes.map(size => sharp(source).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
for (let i = 0; i < images.length; i++) {
  const position = 6 + i * 16;
  header[position] = sizes[i]; header[position + 1] = sizes[i];
  header.writeUInt16LE(1, position + 4); header.writeUInt16LE(32, position + 6);
  header.writeUInt32LE(images[i].length, position + 8); header.writeUInt32LE(offset, position + 12);
  offset += images[i].length;
}
await writeFile(new URL("../src/app/favicon.ico", import.meta.url), Buffer.concat([header, ...images]));
await sharp(source).resize(180, 180).flatten({ background: "#697158" }).png().toFile(new URL("../src/app/apple-icon.png", import.meta.url).pathname);
console.log("Generated favicon.ico (16/32/48/64) and apple-icon.png (180).");
