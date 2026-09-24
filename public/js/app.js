// =============================================================
// EasyFood — front-end
//
// Decisões de projeto:
//   - Autenticação por cookie httpOnly (ADR-006), não mais sessionStorage:
//     o navegador guarda e envia o token sozinho (fetch com
//     credentials: "include"), e nenhum script desta página — nem um
//     eventual script malicioso injetado por XSS — consegue ler o valor.
//   - Toda chamada que muda estado (POST/PUT/DELETE) via cookie precisa
//     repetir, no header X-CSRF-Token, o valor de um segundo cookie
//     (easyfood_csrf, esse sim legível por JavaScript). É o preço de usar
//     cookie: ver o comentário completo em csrfHeader(), abaixo, e
//     docs/adr/ADR-006-jwt-em-cookie-httponly.md.
//   - Como o cookie não é mais lido por este script, "estar logado" deixou
//     de ser algo que dá para checar olhando um valor local: ao carregar a
//     página, o front-end pergunta para a API (GET /auth/me) se existe uma
//     sessão válida — checkSession(), lá embaixo.
//   - Nenhum handler inline (onclick) nem atributo style no HTML — tudo por
//     addEventListener e classes CSS, o que permite uma CSP com
//     script-src 'self', script-src-attr 'none' e style-src 'self'
//     (ver src/app.js). Estilos dinâmicos são aplicados pelo CSSOM
//     (elemento.style.propriedade), que a CSP não bloqueia.
// =============================================================

// A interface é servida pelo próprio Express (mesma origem), então as URLs
// são relativas. Se o HTML for aberto direto do disco (file://), aponta para
// a API local.
const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";
const API_URL = `${API_BASE}/restaurants`;
const AUTH_URL = `${API_BASE}/auth`;

// Quantos restaurantes exibir por vez ("carregar mais" revela mais deste
// array já carregado — não faz uma nova chamada à API, que ainda não tem
// paginação no servidor; ver "Próximos passos" no README).
const PAGE_SIZE = 3;

// Nome do cookie CSRF (não-httpOnly, por isso este script consegue lê-lo).
// Precisa bater com CSRF_COOKIE_NAME em src/shared/cookies.js.
const CSRF_COOKIE_NAME = "easyfood_csrf";

// Estado da lista
let allRestaurants = [];
let filteredRestaurants = [];
let selectedCategory = "Todos";
let searchTerm = "";
let sortMode = "padrao";
let currentPage = 0;

// Estado de autenticação. Não guarda mais token nenhum — só os dados (não
// sensíveis) de quem está logado, para desenhar a interface. A fonte da
// verdade é sempre a API (o cookie httpOnly, que este script nem enxerga).
let currentUser = null;

// Emojis por categoria
const categoryEmoji = {
  Pizza: "🍕",
  Burger: "🍔",
  Sushi: "🍣",
  Saudável: "🥗"
};

// Escapa texto vindo da API antes de inseri-lo via innerHTML (evita XSS).
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Remove acentos para a busca encontrar "saude" mesmo em "Saudável".
function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Lê um cookie pelo nome. Só funciona para cookies SEM httpOnly — é
// exatamente o caso do cookie CSRF (o do JWT continua invisível aqui).
function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// =============================================================
// Acesso à API — ponto único de entrada
// =============================================================

class SessionExpiredError extends Error {}

// Envia a requisição já com:
//   - credentials: "include", que é o que faz o navegador anexar (e aceitar)
//     o cookie httpOnly de autenticação — sem isso, o cookie gravado no
//     login nunca voltaria nas chamadas seguintes;
//   - o header X-CSRF-Token, quando { csrf: true } é passado. Necessário só
//     em requisições que mudam estado (POST/PUT/DELETE): é a "prática" da
//     ADR-006 — o servidor recusa a requisição se esse header não bater com
//     o cookie easyfood_csrf (ver src/modules/auth/csrf.middleware.js). Sem
//     isso, qualquer outro site poderia disparar essas chamadas escondido,
//     usando o cookie que o navegador já anexaria sozinho.
// 401 em requisições marcadas com { handle401: true } é tratado num lugar
// só: sessão encerrada, aviso e redirecionamento para o login.
async function apiFetch(url, options = {}) {
  const { csrf = false, handle401 = false, ...rest } = options;
  const headers = { ...(rest.headers || {}) };

  if (rest.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (csrf) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(url, { ...rest, headers, credentials: "include" });

  if (response.status === 401 && handle401) {
    currentUser = null;
    renderAuthState();
    switchView("profile");
    showAuthMessage("🔒 Sua sessão expirou. Faça login novamente.", "error");
    throw new SessionExpiredError("401");
  }

  let data = null;

  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  return { response, data };
}

// A API devolve { error, details? }. Junta os dois numa frase só.
function apiErrorMessage(data, padrao) {
  if (!data) return padrao;

  if (Array.isArray(data.details) && data.details.length > 0) {
    return data.details.join(". ");
  }

  return data.error || padrao;
}

// ----- SESSÃO -----

// Pergunta para a API se o cookie atual corresponde a uma sessão válida.
// Roda uma vez ao carregar a página — é o substituto de "ler o token do
// sessionStorage", que deixou de existir.
async function checkSession() {
  try {
    const { response, data } = await apiFetch(`${AUTH_URL}/me`);
    currentUser = response.ok ? data.user : null;
  } catch {
    currentUser = null;
  }

  renderAuthState();

  // Se a lista já tiver sido desenhada antes desta resposta chegar, refaz o
  // desenho para mostrar (ou esconder) as ações de dono nos cards.
  if (allRestaurants.length > 0) {
    renderPage();
  }
}

// ----- LOADING -----

function showLoading() {
  const list = document.getElementById("restaurant-list");
  list.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Carregando restaurantes...</p>
    </div>
  `;
}

// ----- FETCH -----

async function fetchRestaurants() {
  showLoading();

  try {
    const { response, data } = await apiFetch(API_URL);

    if (!response.ok) {
      showError();
      return;
    }

    allRestaurants = Array.isArray(data) ? data : [];

    setTimeout(() => {
      refreshList();
    }, 500);
  } catch (error) {
    showError();
  }
}

// ----- FILTRO + BUSCA + ORDENAÇÃO + PAGINAÇÃO -----

function applyFilters() {
  let list = [...allRestaurants];

  if (selectedCategory !== "Todos") {
    list = list.filter((r) => r.category === selectedCategory);
  }

  const termo = normalizeText(searchTerm);
  if (termo !== "") {
    list = list.filter((r) => normalizeText(r.name).includes(termo));
  }

  return sortRestaurants(list, sortMode);
}

function sortRestaurants(list, mode) {
  const arr = [...list];

  switch (mode) {
    case "nome-asc":
      return arr.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    case "nome-desc":
      return arr.sort((a, b) => b.name.localeCompare(a.name, "pt-BR"));
    case "rating-desc":
      return arr.sort((a, b) => Number(b.rating) - Number(a.rating));
    case "rating-asc":
      return arr.sort((a, b) => Number(a.rating) - Number(b.rating));
    default:
      // "padrao": mantém a ordem que veio da API (por id).
      return arr;
  }
}

// Refiltra a partir do que já está em memória (sem nova chamada à API) e
// redesenha. `comSpinner` só existe para reaproveitar o mesmo "flash" de
// carregamento que a troca de categoria sempre teve — buscar e ordenar são
// instantâneos, então não precisam disso.
function refreshList({ comSpinner = false } = {}) {
  const desenhar = () => {
    filteredRestaurants = applyFilters();
    currentPage = 0;
    renderPage();
  };

  if (comSpinner) {
    showLoading();
    setTimeout(desenhar, 300);
  } else {
    desenhar();
  }
}

function isOwner(restaurant) {
  return (
    currentUser &&
    restaurant.userId !== null &&
    restaurant.userId !== undefined &&
    Number(restaurant.userId) === Number(currentUser.id)
  );
}

function renderPage() {
  const list = document.getElementById("restaurant-list");
  const heading = document.getElementById("results-heading");

  heading.textContent =
    filteredRestaurants.length === 1 ? "1 restaurante" : `${filteredRestaurants.length} restaurantes`;

  const end = (currentPage + 1) * PAGE_SIZE;
  const visible = filteredRestaurants.slice(0, end);
  const hasMore = end < filteredRestaurants.length;

  if (visible.length === 0) {
    const mensagem = searchTerm.trim()
      ? `Nenhum restaurante encontrado para "${escapeHtml(searchTerm.trim())}".`
      : "Nenhum restaurante encontrado nessa categoria.";

    list.innerHTML = `
      <div class="empty">
        <div class="icon">🔍</div>
        <p>${mensagem}</p>
      </div>
    `;
    return;
  }

  let html = visible
    .map(
      (restaurant) => `
      <div class="restaurant-card">
        <div class="restaurant-img">
          <span class="placeholder">${categoryEmoji[restaurant.category] || "🏪"}</span>
          <span class="rating-badge"><span class="star">★</span>${escapeHtml(restaurant.rating)}</span>
        </div>
        <div class="restaurant-info">
          <h3>${escapeHtml(restaurant.name)}${
            isOwner(restaurant) ? '<span class="owner-badge">seu</span>' : ""
          }</h3>
          <div class="meta">${escapeHtml(restaurant.category)}</div>
          ${
            isOwner(restaurant)
              ? `<div class="owner-actions">
                   <button type="button" data-action="delete" data-id="${escapeHtml(
                     restaurant.id
                   )}">🗑 Excluir</button>
                 </div>`
              : ""
          }
        </div>
      </div>
    `
    )
    .join("");

  if (hasMore) {
    const remaining = filteredRestaurants.length - end;
    html += `
      <button class="load-more-btn" id="load-more-btn">
        Carregar mais (${remaining} restante${remaining > 1 ? "s" : ""})
      </button>
    `;
  }

  list.innerHTML = html;

  // Entrada escalonada dos cards. O atraso é aplicado pelo CSSOM porque a CSP
  // (style-src 'self') bloqueia o atributo style="" escrito no HTML.
  list.querySelectorAll(".restaurant-card").forEach((card, index) => {
    card.style.animationDelay = `${index * 0.05}s`;
  });
}

// ----- CARREGAR MAIS -----

function loadMore() {
  const btn = document.getElementById("load-more-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="mini-spinner"></span> Carregando...';

  setTimeout(() => {
    currentPage++;
    renderPage();

    const list = document.getElementById("restaurant-list");
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, 400);
}

// ----- EXCLUIR (DELETE /restaurants/:id, só para o dono) -----

async function deleteRestaurant(id, botao) {
  botao.disabled = true;
  botao.textContent = "Excluindo...";

  try {
    const { response, data } = await apiFetch(`${API_URL}/${id}`, {
      method: "DELETE",
      csrf: true,
      handle401: true
    });

    if (response.status !== 204) {
      showFormMessage(`❌ ${apiErrorMessage(data, "Não foi possível excluir")}`, "error");
      botao.disabled = false;
      botao.textContent = "🗑 Excluir";
      return;
    }

    allRestaurants = allRestaurants.filter((r) => Number(r.id) !== Number(id));
    refreshList();
  } catch (error) {
    if (error instanceof SessionExpiredError) return;

    botao.disabled = false;
    botao.textContent = "🗑 Excluir";
    showFormMessage("❌ Erro ao conectar. Verifique se o servidor está rodando.", "error");
  }
}

// ----- ERRO -----

function showError() {
  const list = document.getElementById("restaurant-list");
  list.innerHTML = `
    <div class="error">
      <div class="icon">⚠️</div>
      <p><strong>Servidor offline</strong></p>
      <p class="error-hint">
        Rode no terminal:<br>
        <code>npm start</code>
      </p>
    </div>
  `;
}

// =============================================================
// Navegação entre views (Início / Cadastrar / Perfil)
// =============================================================

function switchView(view) {
  const homeElements = document.querySelectorAll(
    ".search-bar, .categories, .section-header, .restaurant-list"
  );
  const addSection = document.getElementById("add-restaurant-section");
  const profileSection = document.getElementById("profile-section");
  const navItems = document.querySelectorAll(".nav-item");

  homeElements.forEach((el) => (el.style.display = "none"));
  addSection.classList.remove("active");
  profileSection.classList.remove("active");

  if (view === "add") {
    addSection.classList.add("active");
  } else if (view === "profile") {
    profileSection.classList.add("active");
    renderAuthState();
  } else {
    homeElements.forEach((el) => (el.style.display = ""));
  }

  navItems.forEach((item) => {
    item.classList.remove("active");
    if (item.dataset.view === view) {
      item.classList.add("active");
    }
  });
}

// =============================================================
// Autenticação — cadastro / login / logout (JWT em cookie httpOnly)
// =============================================================

function switchAuthTab(tab) {
  document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
  document.querySelector(`.auth-tab[data-tab="${tab}"]`).classList.add("active");

  document.getElementById("login-form").classList.toggle("active", tab === "login");
  document.getElementById("register-form").classList.toggle("active", tab === "register");
}

function renderAuthState() {
  const loggedOut = document.getElementById("auth-logged-out");
  const profileCard = document.getElementById("profile-card");

  if (currentUser) {
    loggedOut.style.display = "none";
    profileCard.classList.add("active");

    document.getElementById("profile-name").textContent = currentUser.name;
    document.getElementById("profile-email").textContent = currentUser.email;
    document.getElementById("profile-avatar").textContent = String(currentUser.name || "?")
      .charAt(0)
      .toUpperCase();
  } else {
    loggedOut.style.display = "block";
    profileCard.classList.remove("active");
  }
}

function showAuthMessage(text, type) {
  const authMessage = document.getElementById("auth-message");
  authMessage.textContent = text;
  authMessage.className = "form-message " + type;
  setTimeout(() => {
    authMessage.className = "form-message";
  }, 4000);
}

function showFormMessage(text, type) {
  const formMessage = document.getElementById("form-message");
  formMessage.textContent = text;
  formMessage.className = "form-message " + type;
  setTimeout(() => {
    formMessage.className = "form-message";
  }, 4000);
}

async function logout() {
  try {
    // Um cookie httpOnly só pode ser apagado por uma resposta do servidor —
    // ao contrário do sessionStorage de antes, o front-end não consegue mais
    // simplesmente "esquecer" a sessão sozinho. Sem CSRF aqui: a pior
    // consequência de um logout forjado por outro site é deslogar a própria
    // pessoa, não uma ação que valha a pena falsificar.
    await apiFetch(`${AUTH_URL}/logout`, { method: "POST" });
  } catch {
    // Mesmo se a chamada falhar (servidor fora do ar), limpa o estado local.
  }

  currentUser = null;
  renderAuthState();
  refreshList();
}

// =============================================================
// Ligação dos eventos (nenhum onclick no HTML)
// =============================================================

function setupEvents() {
  // Filtro por categoria
  const chips = document.querySelectorAll(".category-chip");

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      selectedCategory = chip.dataset.category;
      refreshList({ comSpinner: true });
    });
  });

  // Busca por nome, com um pequeno debounce para não refiltrar a cada tecla
  let searchDebounce = null;
  document.getElementById("search-input").addEventListener("input", (event) => {
    searchTerm = event.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => refreshList(), 250);
  });

  // Ordenação
  document.getElementById("sort-select").addEventListener("change", (event) => {
    sortMode = event.target.value;
    refreshList();
  });

  // Navegação inferior
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => switchView(item.dataset.view));
  });

  // Abas de login / criar conta
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchAuthTab(tab.dataset.tab));
  });

  document.getElementById("logout-btn").addEventListener("click", logout);

  // Botões criados dinamicamente na lista (carregar mais / excluir):
  // delegação de evento na própria lista.
  document.getElementById("restaurant-list").addEventListener("click", (event) => {
    const botao = event.target.closest("button");

    if (!botao) return;

    if (botao.id === "load-more-btn") {
      loadMore();
      return;
    }

    if (botao.dataset.action === "delete") {
      deleteRestaurant(botao.dataset.id, botao);
    }
  });

  setupLoginForm();
  setupRegisterForm();
  setupAddRestaurantForm();
}

function setupLoginForm() {
  const loginForm = document.getElementById("login-form");

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    const loginBtn = document.getElementById("login-btn");
    loginBtn.disabled = true;
    loginBtn.textContent = "Entrando...";

    try {
      const { response, data } = await apiFetch(`${AUTH_URL}/login`, {
        method: "POST",
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        showAuthMessage(`❌ ${apiErrorMessage(data, "Credenciais inválidas")}`, "error");
        return;
      }

      // O cookie já foi gravado pelo navegador (Set-Cookie na resposta); só
      // resta guardar os dados do usuário para desenhar a interface.
      currentUser = data.user;

      loginForm.reset();
      renderAuthState();
      // A lista é redesenhada para mostrar as ações dos restaurantes do dono.
      refreshList();
    } catch (error) {
      showAuthMessage("❌ Erro ao conectar. Verifique se o servidor está rodando.", "error");
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "Entrar";
    }
  });
}

function setupRegisterForm() {
  const registerForm = document.getElementById("register-form");

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("register-name").value.trim();
    const email = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;

    const registerBtn = document.getElementById("register-btn");
    registerBtn.disabled = true;
    registerBtn.textContent = "Criando conta...";

    try {
      const { response, data } = await apiFetch(`${AUTH_URL}/register`, {
        method: "POST",
        body: JSON.stringify({ name, email, password })
      });

      if (!response.ok) {
        showAuthMessage(
          `❌ ${apiErrorMessage(data, "Não foi possível criar a conta")}`,
          "error"
        );
        return;
      }

      showAuthMessage("✅ Conta criada! Agora faça login.", "success");
      registerForm.reset();
      switchAuthTab("login");
    } catch (error) {
      showAuthMessage("❌ Erro ao conectar. Verifique se o servidor está rodando.", "error");
    } finally {
      registerBtn.disabled = false;
      registerBtn.textContent = "Criar conta";
    }
  });
}

function setupAddRestaurantForm() {
  const addForm = document.getElementById("add-restaurant-form");

  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) {
      showFormMessage(
        "🔒 Você precisa entrar na sua conta para cadastrar um restaurante.",
        "error"
      );
      switchView("profile");
      return;
    }

    const name = document.getElementById("restaurant-name").value.trim();
    const category = document.getElementById("restaurant-category").value;
    const rating = parseFloat(document.getElementById("restaurant-rating").value);

    if (!name || !category || Number.isNaN(rating)) {
      showFormMessage("Preencha todos os campos corretamente.", "error");
      return;
    }

    if (rating < 0 || rating > 5) {
      showFormMessage("A avaliação precisa estar entre 0 e 5.", "error");
      return;
    }

    const submitBtn = document.getElementById("submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Cadastrando...";

    try {
      const { response, data } = await apiFetch(API_URL, {
        method: "POST",
        csrf: true,
        handle401: true,
        body: JSON.stringify({ name, category, rating })
      });

      if (!response.ok) {
        showFormMessage(
          `❌ ${apiErrorMessage(data, "Erro ao cadastrar restaurante")}`,
          "error"
        );
        return;
      }

      showFormMessage(`✅ "${data.name}" cadastrado com sucesso!`, "success");

      addForm.reset();

      allRestaurants.push(data);
      refreshList();
    } catch (error) {
      // O 401 já foi tratado dentro do apiFetch (sessão encerrada + aviso).
      if (error instanceof SessionExpiredError) return;

      showFormMessage("❌ Erro ao conectar. Verifique se o servidor está rodando.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Cadastrar restaurante";
    }
  });
}

// =============================================================
// Inicialização
// =============================================================

setupEvents();
renderAuthState(); // estado "deslogado" imediato, sem esperar a rede
checkSession(); // confirma com a API se o cookie corresponde a uma sessão
fetchRestaurants();
