// Função Cloudflare Pages que processa o proxy de liturgia diária do site sagraditurgia.com.br
// Aceita o parâmetro de data ?date=YYYY-MM-DD e retorna JSON estruturado
// Usando apenas fetch padrão e regex – sem DOM parsing.

export default async function(context) {
  const {
    request,
    env,
    waitUntil,
    next,
  } = context;

  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');

  // Validar formato YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateParam || !dateRegex.test(dateParam)) {
    return new Response(
      JSON.stringify({ error: 'Parâmetro de data ausente ou inválido. Use o formato YYYY-MM-DD (ex: 2026-11-15)' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  // Construir a URL do site de origem
  const sourceUrl = `https://sagradaliturgia.com.br/liturgia_diaria.php?date=${dateParam}`;

  let html;
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    html = await response.text();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Falha ao buscar a página de liturgia', details: e.message }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  // Parsear HTML com regex para extrair seções estrutur volatiles
  const parsed = parseLiturgyHtml(html, dateParam);

  // Cache opcional: usando waitUntil para Workers KV ou Cloudflare Cache API se necessário

  return new Response(JSON.stringify(parsed, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60, stale-while-revalidate=300', // cache por 1 minuto + revalidação
    },
  });
}

function parseLiturgyHtml(html, dateParam) {
  // Utiliza regex para extrair seções-chave
  const result = {
    date: dateParam,
    source_url: `https://sagradaliturgia.com.br/liturgia_diaria.php?date=${dateParam}`,
    weekday: null,
    day_of_month: null,
    month: null,
    year: null,
    liturgy_color: null,
    time: null, // ex: 33o. Domingo do Tempo Comum, ou Tempo Natal, Solenidade
    gospel_reference: null,
    first_reading: null,
    psalm: null,
    second_reading: null,
    gospel: null,
    commentary: null,
  };

  // Extrair título do dia: <b>Domingo, 15 de Novembro de 2026</b>
  const titleMatch = html.match(/<b>([^<]+),\s*(\d+)\s+de\s+([^<]+)\s+de\s+(\d+)<\/b>/);
  if (titleMatch) {
    result.weekday = titleMatch[1].trim(); // Domingo
    result.day_of_month = parseInt(titleMatch[2], 10); // 15
    result.month = titleMatch[3].trim(); // Novembro
    result.year = parseInt(titleMatch[4], 10); // 2026
  }

  // Extrair cor da imagem: <img src="https://sagradaliturgia.com.br/images/verde.png" width="140"/>
  const colorMatch = html.match(/<img[^>]*src=["']https:\/\/sagradaliturgia\.com\.br\/images\/([^"\'>]+)["'][^>]*>/);
  if (colorMatch) {
    result.liturgy_color = colorMatch[1]; // verde.png, branco.png, etc.
  }

  // Extrair tempo / solenidade após a imagem: <br><br>33o. Domingo do Tempo Comum</center><hr>
  const timeMatch = html.match(/<center><b>.*?<\/b><br><br>(.*?)<\/center><hr>/);
  if (timeMatch && timeMatch[1]) {
    result.time = timeMatch[1].trim();
  } else {
    // Fallback: tentar extrair após imagem e antes de <hr>
    const altTimeMatch = html.match(/<img[^>]*>[\s\S]*?<hr>\s*([^\n\r]*?)<\/b>/);
    if (altTimeMatch && altTimeMatch[1]) {
      result.time = altTimeMatch[1].trim();
    }
  }

  // Evangelho do dia: <b>Evangelho do dia: São Mateus 25, 14-30</b>
  const gospelRefMatch = html.match(/<b>Evangelho do dia:\s*([^<]+)<\/b>/);
  if (gospelRefMatch && gospelRefMatch[1]) {
    result.gospel_reference = gospelRefMatch[1].trim();
  }

  // Primeira leitura: <b>Primeira leitura: Provérbios 31, 10-13.19-20.30-31</b>
  const firstReadRefMatch = html.match(/<b>Primeira leitura:\s*([^<]+)<\/b>/);
  if (firstReadRefMatch && firstReadRefMatch[1]) {
    const refText = firstReadRefMatch[1].trim();
    result.first_reading = { reference: refText, text: null, label: null };
    // Extrair o rótulo: Leitura do Livro dos Provérbios:
    const labelMatch = html.match(/<b>Primeira leitura:[^<]*<\/b>\s*([^\n]*Leitura do Livro [^<]+):/);
    if (labelMatch && labelMatch[1]) {
      result.first_reading.label = labelMatch[1].trim();
    } else {
      result.first_reading.label = 'Leitura do Livro dos Provérbios:';
    }
    // Extrair texto da primeira leitura até <br><br> próximo? Pode ser complexo; para simplificar, extrair após o <b>Primeira leitura</b> até o próximo <b>Salmo</b> (ou semelhante)
    const firstReadStartIdx = html.indexOf('<b>Primeira leitura:');
    const firstReadEndIdx = html.indexOf('<b>Salmo', firstReadStartIdx);
    if (firstReadEndIdx !== -1) {
      const firstReadHtml = html.substring(firstReadStartIdx, firstReadEndIdx);
      // Remover todas as tags <b>, <br>, <br> para texto puro
      const cleaned = firstReadHtml.replace(/<\/?b>/g, '').replace(/<br\s*\/>/g, '\n\n').replace(/&nbsp;/g, ' ');
      // Remover possíveis rótulos extras e etiquetas
      result.first_reading.text = cleaned.trim();
    }
  }

  // Salmo: <b>Salmo 127 (128)</b><br>... texto com <br> para linhas. Pode incluir os rótulos R:
  const psalmStart = html.indexOf('<b>Salmo');
  const psalmEnd = html.indexOf('<b>Segunda leitura', psalmStart);
  if (psalmStart !== -1 && psalmEnd !== -1) {
    const psalmHtml = html.substring(psalmStart, psalmEnd);
    // Extrair referência dentro de <b>Salmo ...</b>
    const psalmRefMatch = psalmHtml.match(/<b>(Salmo [^<]+)<\/b>/);
    const psalmRef = psalmRefMatch ? psalmRefMatch[1].trim() : null;
    // Remover <b>Salmo ...</b> e <br> para texto plano
    let psalmText = psalmHtml.replace(/<\/?b>/g, '').replace(/<br\s*\/>/g, '\n').replace(/&nbsp;/g, ' ');
    // Remover rótulo extra: 'Salmo 127 (128)' já está em result.first_reading? Na verdade, esta é a referência do salmo; mantemos o rótulo R:
    result.psalm = { reference: psalmRef, text: psalmText.trim() };
  }

  // Segunda leitura: <b>Segunda leitura: Tessalonicenses 5, 1-6</b> ... etc.
  const secondReadStart = html.indexOf('<b>Segunda leitura:');
  const gospelStart = html.indexOf('<b>Evangelho de Jesus Cristo', secondReadStart);
  if (secondReadStart !== -1 && gospelStart !== -1) {
    const secondReadHtml = html.substring(secondReadStart, gospelStart);
    const secondReadRefMatch = secondReadHtml.match(/<b>Segunda leitura:\s*([^<]+)<\/b>/);
    const secondReadRef = secondReadRefMatch ? secondReadRefMatch[1].trim() : null;
    // Extrair o rótulo: Leitura da Primeira Carta de São Paulo aos Tessalonicenses:
    const labelMatch = secondReadHtml.match(/<b>Segunda leitura:[^<]*<\/b>\s*([^\n]*Leitura da [^<]+):/);
    let label = 'Leitura da Primeira Carta de São Paulo aos Tessalonicenses:';
    if (labelMatch && labelMatch[1]) label = labelMatch[1].trim();
    // Texto: remover tags <b>, <br>
    let secondReadText = secondReadHtml.replace(/<\/?b>/g, '').replace(/<br\s*\/>/g, '\n\n').replace(/&nbsp;/g, ' ');
    result.second_reading = { reference: secondReadRef, text: secondReadText.trim(), label: label };
  }

  // Evangelho (conteúdo completo): pode ter <b>Evangelho de Jesus Cristo segundo São Mateus 25, 14-30</b> e várias partes (Aleluia, Proclamação, etc.)
  const fullGospelStart = html.indexOf('<b>Evangelho de Jesus Cristo');
  const commentaryStart = html.indexOf('<b>Comentário do dia', fullGospelStart);
  if (fullGospelStart !== -1 && commentaryStart !== -1) {
    const gospelHtml = html.substring(fullGospelStart, commentaryStart);
    // Extrair a referência: <b>Evangelho de Jesus Cristo segundo São Mateus 25, 14-30</b>
    const gospelRefMatch = gospelHtml.match(/<b>Evangelho de Jesus Cristo segundo ([^<]+)<\/b>/);
    const gospelRef = gospelRefMatch ? `${gospelRefMatch[1].trim()}` : null;
    // Se não houver referência, tentar extrair com Evangelho de Jesus Cristo... mas manter simples.
    // O texto do evangelho contém <b> Aleluia, Aleluia, Aleluia! </b> etc. Extrair todo o texto, mas precisamos de texto plano.
    let gospelText = gospelHtml.replace(/<\/?b>/g, '').replace(/<br\s*\/>/g, '\n\n').replace(/&nbsp;/g, ' ');
    // Remover espaços extras e limpar
    gospelText = gospelText.replace(/\n{3,}/g, '\n\n');
    result.gospel = { reference: gospelRef, text: gospelText.trim() };
  }

  // Comentário: <b>Comentário do dia por São João Crisóstomo</b> ... Presbítero de Antioquia... texto ...
  const commentStart = html.indexOf('<b>Comentário do dia');
  if (commentStart !== -1) {
    const commentHtml = html.substring(commentStart);
    const commentRefMatch = commentHtml.match(/<b>Comentário do dia por ([^<]+)<\/b>/);
    const author = commentRefMatch ? commentRefMatch[1].trim() : null;
    // Extrair fonte: Presbítero de Antioquia, Bispo de Constantinopla, Doutor da Igreja<br>Homilias sobre o Evangelho de São Mateus, n.º 78, 2-3
    const sourceMatch = commentHtml.match(/Presb&iacute;tero de Antioquia.*?Homilias sobre o Evangelho de S&atilde;o Mateus[^<]*<\/b>/);
    const source = sourceMatch ? sourceMatch[0].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim() : null;
    // Remover todas as tags HTML para texto simples
    let commentText = commentHtml.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
    commentText = commentText.replace(/\s{2,}/g, ' ').trim();
    result.commentary = { author, source, text: commentText };
  }

  return result;
}