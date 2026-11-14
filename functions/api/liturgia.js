// Cloudflare Pages Function — API de Liturgia Diária (fonte: liturgia.cancaonova.com)
// Endpoint: GET /api/liturgia?date=YYYY-MM-DD
// Retorna JSON estruturado com as leituras, salmo e evangelho do dia.

const BASE = 'https://liturgia.cancaonova.com/pb';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const HTML_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û',
  atilde: 'ã', otilde: 'õ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í',
  Oacute: 'Ó', Uacute: 'Ú', Atilde: 'Ã', Otilde: 'Õ', Acirc: 'Â',
  Ecirc: 'Ê', Ocirc: 'Ô', ccedil: 'ç', Ccedil: 'Ç',
  laquo: '«', raquo: '»', hellip: '…', deg: 'º', ordm: 'º', ordf: 'ª',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—',
  copy: '©', reg: '®', trade: '™',
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (_, name) => (HTML_ENTITIES[name] !== undefined ? HTML_ENTITIES[name] : `&${name};`));
}

function normalizeText(text) {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

// Converte o HTML de uma seção em linhas de texto limpo.
function sectionToLines(sectionHtml) {
  let txt = sectionHtml
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ') // áudio embutido
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  txt = decodeEntities(txt);
  return txt
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);
}

// Separa as linhas de uma seção em intro / alleluia / proclamation / text.
// O campo "text" contém todo o texto restante (incluindo respostas "- Palavra do Senhor" etc.).
function splitReadingLines(lines, num) {
  const out = { intro: null, alleluia: null, proclamation: null, text: [] };
  let i = 0;

  // Pula a linha de cabeçalho (ex: "Primeira Leitura (Pr 31,10-13...)")
  if (i < lines.length && /^(Primeira Leitura|Segunda Leitura|Responsório|Evangelho)\b/.test(lines[i])) {
    i++;
  }

  // Linha de introdução: "Leitura do ..." / "Responsório Sl ..."
  if (i < lines.length && /^(Leitura|Responsório)/.test(lines[i])) {
    out.intro = lines[i];
    i++;
  }

  // No evangelho: Aleluia + versículo da aclamação + proclamação
  if (num === '4' && i < lines.length && /^- Aleluia/.test(lines[i])) {
    const acc = [lines[i]];
    i++;
    if (i < lines.length && /^- /.test(lines[i])) {
      acc.push(lines[i]);
      i++;
    }
    out.alleluia = acc.join('\n');
    if (i < lines.length && /^Proclamação/.test(lines[i])) {
      out.proclamation = lines[i];
      i++;
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/Conferência Nacional dos Bispos|Todos os direitos reservados/.test(line)) continue;
    out.text.push(line);
  }

  return out;
}

// Resolve o slug da liturgia para uma data usando o calendário do mês.
async function resolveSlug(dateStr, waitUntil) {
  const [y, m] = dateStr.split('-').map(Number);
  const calUrl = `${BASE}/liturgia/?sDia=1&sMes=${m}&sAno=${y}`;

  const cache = caches.default;
  const cachedCal = await cache.match(calUrl);
  let html;
  if (cachedCal) {
    html = await cachedCal.text();
  } else {
    const res = await fetch(calUrl, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`calendário HTTP ${res.status}`);
    html = await res.text();
    const respToCache = new Response(html, { headers: { 'cache-control': 'public, max-age=86400' } });
    if (waitUntil) waitUntil(cache.put(calUrl, respToCache));
  }

  const linkRe = /<a\s+href="(https:\/\/liturgia\.cancaonova\.com\/pb\/liturgia\/([a-z0-9-]+)\/\?sDia=(\d+)&sMes=(\d+)&sAno=(\d+))"[^>]*>\s*\d+\s*<\/a>/g;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const slug = match[2];
    const day = String(match[3]).padStart(2, '0');
    const month = String(match[4]).padStart(2, '0');
    const year = match[5];
    if (`${year}-${month}-${day}` === dateStr) {
      return slug;
    }
  }
  return null;
}

function parseContentPage(html, dateStr, pageUrl) {
  const result = {
    date: dateStr,
    source_url: pageUrl,
    weekday: null,
    day: null,
    month: null,
    year: null,
    liturgy_color: null,
    title: null,
    first_reading: null,
    psalm: null,
    second_reading: null,
    gospel: null,
  };

  // Título litúrgico
  const h1 = html.match(/<h1 class="entry-title">([\s\S]*?)<\/h1>/);
  if (h1) result.title = normalizeText(h1[1]);

  // Data exibida no site
  const dia = html.match(/<span class='dia'>(\d+)<\/span>/);
  const mes = html.match(/<span class='mes'>([^<]+)<\/span>/);
  const ano = html.match(/<span class='ano'>(\d+)<\/span>/);
  if (dia) result.day = parseInt(dia[1], 10);
  if (mes) result.month = mes[1].trim();
  if (ano) result.year = parseInt(ano[1], 10);

  // Cor litúrgica
  const color = html.match(/Cor Litúrgica:\s*([^<\n]+)/);
  if (color) result.liturgy_color = color[1].trim();

  // Nome do dia da semana calculado a partir da data
  const [yy, mm, dd] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(yy, mm - 1, dd));
  const weekdays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  result.weekday = weekdays[d.getUTCDay()];

  // Referências do menu de abas
  const refs = {};
  const navRe = /<a id="lit-(\d)"[^>]*href="#liturgia-\d">\s*<label class="liturgia tipo-titulo">([^<]+)<\/label>\s*<div class="referencia">([^<]+)<\/div>/g;
  let nm;
  while ((nm = navRe.exec(html)) !== null) {
    refs[nm[1]] = { label: nm[2].trim(), reference: nm[3].trim() };
  }

  // Seções de conteúdo
  const secRe = /<div id="liturgia-(\d)" class="tab-pane[^"]*">/g;
  const sections = [];
  let sm;
  while ((sm = secRe.exec(html)) !== null) {
    sections.push({ num: sm[1], start: sm.index + sm[0].length });
  }

  const articleEnd = html.indexOf('</article>');

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const nextStart = i + 1 < sections.length ? sections[i + 1].start : articleEnd !== -1 ? articleEnd : html.length;
    const bodyHtml = html.substring(sec.start, nextStart);
    const lines = sectionToLines(bodyHtml);
    const meta = refs[sec.num] || { label: null, reference: null };
    const parts = splitReadingLines(lines, sec.num);

    const entry = {
      label: meta.label,
      reference: meta.reference,
      intro: parts.intro,
      text: parts.text.join('\n'),
    };
    if (parts.alleluia) entry.alleluia = parts.alleluia;
    if (parts.proclamation) entry.proclamation = parts.proclamation;

    if (sec.num === '1') result.first_reading = entry;
    else if (sec.num === '2') result.psalm = entry;
    else if (sec.num === '3') result.second_reading = entry;
    else if (sec.num === '4') result.gospel = entry;
  }

  return result;
}

export async function onRequest(context) {
  const { request } = context;

  // Preflight CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Método não permitido. Use GET.' }), {
      status: 405,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }

  return handleRequest(context);
}

async function handleRequest(context) {
  const { request, waitUntil } = context;

  const url = new URL(request.url);

  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Método não permitido. Use GET.' }), {
      status: 405,
      headers: { 'content-type': 'application/json', ...corsHeaders },
    });
  }

  const dateParam = url.searchParams.get('date');
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateParam || !dateRegex.test(dateParam)) {
    return new Response(
      JSON.stringify({ error: 'Parâmetro "date" ausente ou inválido. Use o formato YYYY-MM-DD. Exemplo: /api/liturgia?date=2026-11-15' }),
      { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } },
    );
  }

  // Valida se a data realmente existe
  const [yy, mm, dd] = dateParam.split('-').map(Number);
  const check = new Date(Date.UTC(yy, mm - 1, dd));
  if (check.getUTCFullYear() !== yy || check.getUTCMonth() !== mm - 1 || check.getUTCDate() !== dd) {
    return new Response(JSON.stringify({ error: 'Data inválida (ex: 2026-02-30 não existe).' }), {
      status: 400,
      headers: { 'content-type': 'application/json', ...corsHeaders },
    });
  }

  const cacheKey = new Request(`${url.origin}/api/liturgia?date=${dateParam}`, request);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let slug;
  try {
    slug = await resolveSlug(dateParam, waitUntil);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Falha ao buscar o calendário litúrgico', details: e.message }), {
      status: 502,
      headers: { 'content-type': 'application/json', ...corsHeaders },
    });
  }

  if (!slug) {
    return new Response(JSON.stringify({ error: 'Liturgia não encontrada para a data informada.', date: dateParam }), {
      status: 404,
      headers: { 'content-type': 'application/json', ...corsHeaders },
    });
  }

  const pageUrl = `${BASE}/liturgia/${slug}/?sDia=${dd}&sMes=${mm}&sAno=${yy}`;

  let html;
  try {
    const pageRes = await fetch(pageUrl, { headers: { 'user-agent': UA } });
    if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status}`);
    html = await pageRes.text();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Falha ao buscar a página da liturgia', details: e.message }), {
      status: 502,
      headers: { 'content-type': 'application/json', ...corsHeaders },
    });
  }

  const parsed = parseContentPage(html, dateParam, pageUrl);

  const response = new Response(JSON.stringify(parsed, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      ...corsHeaders,
    },
  });

  waitUntil?.(cache.put(cacheKey, response.clone()));

  return response;
}
