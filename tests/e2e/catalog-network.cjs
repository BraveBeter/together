// Isolate provider traffic in the test server, not in the production application.
const originalFetch = globalThis.fetch;
const fixture = (index, kind = 'movie') => ({
  uuid: `bulkFixture${String(index).padStart(12, '0')}`, category: kind, type: kind === 'book' ? 'Edition' : 'Movie',
  title: kind === 'book' ? `批量书籍${index}` : `批量电影${index}`, director: ['测试导演'], author: ['测试作者'],
  year: 2014, pub_year: 2012, pub_house: '测试出版社', description: '用于双账户流程的客观资料。',
  genre: [index % 3 === 0 ? 'Animation' : index % 3 === 1 ? 'Sci-Fi' : 'Drama'],
  cover_image_url: 'https://film.upstairs.cn/m/bulk-fixture.png',
});
globalThis.fetch = async function(input, options) {
  const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(address);
  if (!['film.upstairs.cn', 'eggplant.place'].includes(url.hostname)) return originalFetch(input, options);
  if (url.pathname.startsWith('/m/')) {
    const sharp = require('sharp');
    const bytes = await sharp({ create: { width: 160, height: 240, channels: 3, background: '#395a67' } }).png().toBuffer();
    return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
  }
  if (url.pathname === '/api/catalog/search') {
    const query = url.searchParams.get('query'), kind = url.searchParams.get('category');
    const n = query?.match(/^批量(?:电影|书籍)(\d+)$/)?.[1];
    let data = n ? [fixture(+n, kind)] : [];
    if (query === '同名版本测试') data = [{ ...fixture(97), title: query }, { ...fixture(98), title: query, year: 2019 }];
    return Response.json({ data: url.hostname === 'eggplant.place' ? [] : data });
  }
  const matched = url.pathname.match(/^\/api\/(movie|book)\/bulkFixture(\d+)$/);
  if (matched) return Response.json(fixture(+matched[2], matched[1]));
  return Response.json({ error: 'Unknown test fixture' }, { status: 404 });
};
