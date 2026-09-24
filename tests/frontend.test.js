// Front-end × Content-Security-Policy.
//
// A CSP do servidor (src/app.js) só aceita script e estilo da própria origem.
// Se o HTML ou o JS voltarem a gerar `style="..."` ou `onclick="..."`, o
// navegador passa a bloquear esses trechos — e nenhum teste de HTTP percebe,
// porque o servidor responde normalmente. Este arquivo protege essa regra
// olhando o código da interface.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { startTestServer, createClient } = require("./helpers/server");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

function ler(relativo) {
  return fs.readFileSync(path.join(PUBLIC_DIR, relativo), "utf8");
}

// Tira comentários para que uma explicação em texto não seja confundida com código.
function semComentariosDeHtml(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function semComentariosDeJs(js) {
  return js
    .split("\n")
    .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
    .join("\n");
}

// Uma tag de abertura com o atributo, na mesma linha: `<div class="x" style=...`.
const ATRIBUTO_STYLE = /<[a-z][^>\n]*\sstyle\s*=/i;
const HANDLER_INLINE = /<[a-z][^>\n]*\son[a-z]+\s*=/i;

test("index.html não usa style nem handlers inline", () => {
  const html = semComentariosDeHtml(ler("index.html"));

  assert.doesNotMatch(html, ATRIBUTO_STYLE);
  assert.doesNotMatch(html, HANDLER_INLINE);
  assert.doesNotMatch(html, /<style[\s>]/i);
});

test("todo <script> do index.html vem de um arquivo (src), nunca inline", () => {
  const html = semComentariosDeHtml(ler("index.html"));
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];

  assert.ok(scripts.length > 0, "a interface precisa carregar o app.js");

  for (const [, atributos] of scripts) {
    assert.match(atributos, /\bsrc\s*=/, `script inline encontrado: <script ${atributos}>`);
  }
});

test("app.js não gera HTML com style nem handlers inline", () => {
  const js = semComentariosDeJs(ler("js/app.js"));

  assert.doesNotMatch(js, ATRIBUTO_STYLE, "use uma classe CSS ou o CSSOM (elemento.style.x)");
  assert.doesNotMatch(js, HANDLER_INLINE, "use addEventListener");
  assert.doesNotMatch(js, /setAttribute\(\s*["']style["']/);
  assert.doesNotMatch(js, /\beval\(|new Function\(/);
});

test("a classe .error-hint usada pelo app.js existe no CSS", () => {
  const js = ler("js/app.js");
  const css = ler("css/styles.css");

  assert.match(js, /class="error-hint"/);
  assert.match(css, /\.error-hint\s*\{/);
});

test("a CSP do servidor continua exigindo 'self' e não libera código inline", async () => {
  const server = await startTestServer();

  try {
    const response = await createClient(server.baseUrl)("/");
    const csp = response.headers.get("content-security-policy") ?? "";

    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /script-src-attr 'none'/);
    assert.match(csp, /style-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
  } finally {
    await server.close();
  }
});
