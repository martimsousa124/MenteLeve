(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const protectedTargets = new Set(["#diario", "#chat", "#marcar"]);
  const returnKey = "ml:return-to";
  const moods = [
    ["Muito em baixo", "#B49CCE", "M8 17q4-4 8 0"],
    ["Em baixo", "#E5E5F5", "M9 16.5q3-2.5 6 0"],
    ["Neutro", "#EBDFCE", "M9 16h6"],
    ["Bem", "#C2DDAE", "M8.5 15q3.5 3 7 0"],
    ["Muito bem", "#C2DDAE", "M7.5 14q4.5 6 9 0"],
  ];

  let user = null;
  let authReady = false;
  let platform = { chatAvailable: false, appointmentsAvailable: false, contactAvailable: false };
  let diaryKind = "e";
  let editingId = null;
  let selectedMood = null;
  let diaryEntries = [];
  let toastTimer;
  let waveObserver;

  class RequestError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function request(path, options = {}) {
    try {
      return await window.MenteLeveDemo.request(path, options);
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(error.message || "Não foi possível concluir o pedido.", error.status || 0);
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("on"), 3800);
  }

  function closeMenu() {
    const nav = $("#nav");
    const button = $("#bg");
    if (!nav || !button) return;
    nav.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Abrir menu");
    button.innerHTML = '<svg class="ic"><use href="#menu"/></svg>';
  }

  function initNavigation() {
    const nav = $("#nav");
    const button = $("#bg");
    if (nav && button) {
      button.addEventListener("click", () => {
        const open = !nav.classList.contains("open");
        nav.classList.toggle("open", open);
        button.setAttribute("aria-expanded", String(open));
        button.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
        button.innerHTML = `<svg class="ic"><use href="#${open ? "x" : "menu"}"/></svg>`;
      });
      nav.addEventListener("click", (event) => {
        if (event.target.closest("a")) closeMenu();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMenu();
      });
    }

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });
      $$(".rv").forEach((element) => observer.observe(element));

      waveObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle("wave-active", entry.isIntersecting);
        });
      }, { rootMargin: "180px 0px", threshold: 0 });
      $$("main > section, footer").forEach((section) => {
        const wave = $(".section-wave", section);
        if (wave) waveObserver.observe(wave);
      });
    } else {
      $$(".rv").forEach((element) => element.classList.add("in"));
    }

    $$(".faq-question").forEach((question) => {
      question.addEventListener("click", () => {
        question.closest(".faq-item")?.classList.toggle("open");
      });
    });
  }

  function setAuthError(id, message) {
    const error = $(id);
    if (error) error.textContent = message;
  }

  function displayAuthState() {
    const forms = $("#authForms");
    const account = $("#accountPanel");
    const greeting = $("#accountGreeting");
    const authNotice = $("#authNotice");
    if (!forms || !account) return;

    forms.hidden = Boolean(user);
    account.hidden = !user;
    if (greeting && user) greeting.textContent = `Sessão iniciada como ${user.name} (${user.email}).`;
    if (authNotice) {
      authNotice.textContent = user ? "A tua sessão está ativa neste dispositivo." : "";
    }
    $$(".diary-control").forEach((control) => { control.disabled = !user; });
    const diaryStatus = $("#diaryStatus");
    if (diaryStatus) {
      diaryStatus.textContent = user
        ? "As tuas entradas estão associadas à tua conta."
        : "Inicia sessão para consultar ou guardar entradas do diário.";
    }
    configurePrivateFeatures();
  }

  function setAuthMode(mode) {
    const isRegister = mode === "register";
    $("#loginForm").hidden = isRegister;
    $("#registerForm").hidden = !isRegister;
    $("#showLogin").setAttribute("aria-selected", String(!isRegister));
    $("#showRegister").setAttribute("aria-selected", String(isRegister));
    $("#authHeading").textContent = isRegister ? "Criar conta" : "A tua conta Mente Leve";
    $("#authIntro").textContent = isRegister
      ? "Usa uma palavra-passe única com pelo menos 12 caracteres."
      : "Inicia sessão para aceder ao teu diário e aos teus pedidos.";
    setAuthError("#loginError", "");
    setAuthError("#registerError", "");
  }

  function safeReturnTarget() {
    const target = sessionStorage.getItem(returnKey);
    sessionStorage.removeItem(returnKey);
    return protectedTargets.has(target) ? target : "#inicio";
  }

  async function authenticate(form, endpoint, errorSelector) {
    setAuthError(errorSelector, "");
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(data),
      });
      user = result.user;
      authReady = true;
      form.reset();
      displayAuthState();
      showToast(endpoint.endsWith("register") ? "Conta criada e sessão iniciada." : "Sessão iniciada.");
      const hadTarget = Boolean(sessionStorage.getItem(returnKey));
      const destination = safeReturnTarget();
      const afterRegister = endpoint.endsWith("register") && !hadTarget ? "#diario" : destination;
      location.hash = afterRegister;
      if (afterRegister === "#diario") await loadDiary();
      if (afterRegister === "#chat") await loadChat();
      if (afterRegister === "#marcar") focusAppointment();
    } catch (error) {
      setAuthError(errorSelector, error.message);
    }
  }

  function initAuth() {
    $("#showLogin").addEventListener("click", () => setAuthMode("login"));
    $("#showRegister").addEventListener("click", () => setAuthMode("register"));
    $("#loginForm").addEventListener("submit", (event) => {
      event.preventDefault();
      authenticate(event.currentTarget, "/api/auth/login", "#loginError");
    });
    $("#registerForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (form.elements.password.value !== form.elements.confirmPassword.value) {
        setAuthError("#registerError", "As palavras-passe não coincidem.");
        form.elements.confirmPassword.focus();
        return;
      }
      if (form.elements.password.value.length < 12) {
        setAuthError("#registerError", "A palavra-passe tem de ter pelo menos 12 caracteres.");
        form.elements.password.focus();
        return;
      }
      authenticate(form, "/api/auth/register", "#registerError");
    });
    $("#resetPassword").addEventListener("click", async () => {
      setAuthError("#loginError", "");
      const email = $("#loginEmail").value.trim();
      if (!email) {
        setAuthError("#loginError", "Indica primeiro o email associado à conta.");
        $("#loginEmail").focus();
        return;
      }
      try {
        await request("/api/auth/password-reset", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
      } catch (error) {
        setAuthError("#loginError", error.message);
      }
    });
    $("#logoutButton").addEventListener("click", async () => {
      try {
        await request("/api/auth/logout", { method: "POST", body: "{}" });
        user = null;
        diaryEntries = [];
        displayAuthState();
        renderDiary();
        showToast("Sessão terminada.");
        if (protectedTargets.has(location.hash)) location.hash = "#entrar";
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  function requireLogin(destination) {
    if (user) return true;
    sessionStorage.setItem(returnKey, destination);
    location.hash = "#entrar";
    $("#authNotice").textContent = "Inicia sessão ou cria uma conta para continuar.";
    $("#loginEmail").focus({ preventScroll: true });
    return false;
  }

  function initProtectedNavigation() {
    document.addEventListener("click", async (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || !protectedTargets.has(link.getAttribute("href"))) return;
      const destination = link.getAttribute("href");
      let waitedForSession = false;
      if (!authReady) {
        waitedForSession = true;
        event.preventDefault();
        try {
          const result = await request("/api/auth/me");
          user = result.user;
          authReady = true;
          displayAuthState();
        } catch (error) {
          authReady = true;
          if (error.status !== 401) {
            showToast(error.message);
            return;
          }
        }
      }
      if (!requireLogin(destination)) {
        event.preventDefault();
        return;
      }
      if (waitedForSession) location.hash = destination;
      if (destination === "#diario") loadDiary();
      if (destination === "#chat") loadChat();
      if (destination === "#marcar") focusAppointment();
    });

    window.addEventListener("hashchange", () => {
      closeMenu();
      if (protectedTargets.has(location.hash) && authReady && !user) {
        sessionStorage.setItem(returnKey, location.hash);
        location.hash = "#entrar";
      } else if (location.hash === "#diario" && user) {
        loadDiary();
      } else if (location.hash === "#chat" && user) {
        loadChat();
      } else if (location.hash === "#marcar" && user) {
        focusAppointment();
      }
    });
  }

  function initMoodOptions() {
    const group = $("#moods");
    moods.forEach(([label, color, path], index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mo diary-control";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");
      button.setAttribute("aria-label", label);
      button.tabIndex = index === 0 ? 0 : -1;
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="${color}"/><circle cx="9" cy="10" r="1.2" fill="#413D5E"/><circle cx="15" cy="10" r="1.2" fill="#413D5E"/><path d="${path}" stroke="#413D5E" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>${label}`;
      button.addEventListener("click", () => selectMood(index));
      group.append(button);
    });
    group.addEventListener("keydown", (event) => {
      const current = moods.findIndex((_, index) =>
        group.children[index].getAttribute("aria-checked") === "true"
      );
      let next = current;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1 + moods.length) % moods.length;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + moods.length) % moods.length;
      if (next !== current) {
        event.preventDefault();
        selectMood(next);
      }
    });
  }

  function selectMood(index) {
    selectedMood = index;
    $$("#moods button").forEach((button, current) => {
      button.setAttribute("aria-checked", String(current === index));
      button.tabIndex = current === index ? 0 : -1;
    });
    $$("#moods button")[index]?.focus();
  }

  function setDiaryTab(kind) {
    diaryKind = kind;
    const buttons = $$(".tabs button");
    buttons.forEach((button, index) => {
      button.setAttribute("aria-selected", String("emgp"[index] === kind));
    });
    const hasText = kind === "e" || kind === "g";
    const hasMood = kind === "e" || kind === "m";
    $("#mq").hidden = !hasMood;
    $("#moods").hidden = !hasMood;
    $("#lb").hidden = !hasText;
    $("#tx").hidden = !hasText;
    $("#sv").parentElement.hidden = kind === "p";
    $("#pg").hidden = kind !== "p";
    $("#lb").textContent = kind === "g" ? "Pelo que és grato hoje?" : "Escreve aqui o que te vai na mente...";
    $("#tx").placeholder = $("#lb").textContent;
    $("#er").textContent = "";
    if (kind === "p") renderProgress();
  }

  function initDiary() {
    initMoodOptions();
    $$(".tabs button").forEach((button, index) => {
      button.addEventListener("click", () => setDiaryTab("emgp"[index]));
    });
    $("#sv").addEventListener("click", saveEntry);
    $("#cn").addEventListener("click", resetEntry);
    $("#hist").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "edit") editEntry(button.dataset.id);
      if (button.dataset.action === "delete") await deleteEntry(button.dataset.id);
    });
    setDiaryTab("e");
    renderCalendar([]);
  }

  function resetEntry() {
    editingId = null;
    selectedMood = null;
    $("#tx").value = "";
    $("#cn").hidden = true;
    $("#sv").textContent = "Guardar entrada";
    $("#er").textContent = "";
    $$("#moods button").forEach((button, index) => {
      button.setAttribute("aria-checked", "false");
      button.tabIndex = index === 0 ? 0 : -1;
    });
  }

  function renderDiary() {
    const list = $("#hist");
    list.replaceChildren();
    const entries = [...diaryEntries].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (!user || entries.length === 0) {
      const item = document.createElement("li");
      item.className = "em";
      item.textContent = user ? "Ainda não tens entradas." : "Inicia sessão para ver as tuas entradas.";
      list.append(item);
    }
    entries.forEach((entry) => {
      const item = document.createElement("li");
      const heading = document.createElement("div");
      heading.className = "hh";
      const date = new Date(entry.created_at);
      const mood = Number.isInteger(entry.mood) ? moods[entry.mood] : null;
      heading.textContent = `${date.toLocaleString("pt-PT", { dateStyle: "medium", timeStyle: "short" })} · ${({ e: "Escrita", m: "Estado de espírito", g: "Gratidão" })[entry.kind] || "Entrada"}${mood ? ` · ${mood[0]}` : ""}`;
      item.append(heading);
      if (entry.text) {
        const text = document.createElement("p");
        text.textContent = entry.text;
        item.append(text);
      }
      if (mood) item.style.borderLeftColor = mood[1];
      if (user) {
        const actions = document.createElement("div");
        actions.className = "ha";
        [["Editar", "edit"], ["Eliminar", "delete"]].forEach(([label, action]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "lk";
          button.textContent = label;
          button.dataset.action = action;
          button.dataset.id = entry.id;
          actions.append(button);
        });
        item.append(actions);
      }
      list.append(item);
    });
    renderCalendar(entries);
    if (diaryKind === "p") renderProgress();
  }

  function renderCalendar(entries) {
    const grid = $("#cg");
    if (!grid) return;
    grid.replaceChildren();
    const today = new Date();
    $("#cmh").textContent = today.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
    ["S", "T", "Q", "Q", "S", "S", "D"].forEach((day) => {
      const heading = document.createElement("b");
      heading.setAttribute("aria-hidden", "true");
      heading.textContent = day;
      grid.append(heading);
    });
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const current = entries.filter((entry) => {
      const date = new Date(entry.created_at);
      return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
    });
    const moodsByDay = new Map();
    current.forEach((entry) => {
      if (Number.isInteger(entry.mood)) {
        const day = new Date(entry.created_at).getDate();
        if (!moodsByDay.has(day)) moodsByDay.set(day, entry.mood);
      }
    });
    for (let index = 0; index < offset; index += 1) {
      const blank = document.createElement("i");
      blank.setAttribute("aria-hidden", "true");
      grid.append(blank);
    }
    for (let day = 1; day <= days; day += 1) {
      const cell = document.createElement("i");
      cell.textContent = String(day);
      if (day === today.getDate()) cell.classList.add("td");
      if (moodsByDay.has(day)) {
        const mood = moods[moodsByDay.get(day)];
        cell.style.background = mood[1];
        cell.style.color = "#413D5E";
        cell.title = mood[0];
        cell.setAttribute("aria-label", `${day}: ${mood[0]}`);
      }
      grid.append(cell);
    }
    const positive = current.filter((entry) => Number.isInteger(entry.mood) && entry.mood >= 3).length;
    const difficult = current.filter((entry) => Number.isInteger(entry.mood) && entry.mood <= 1).length;
    $("#s1").textContent = String(current.length);
    $("#s2").textContent = String(positive);
    $("#s3").textContent = String(difficult);
    $("#s4").textContent = String(current.filter((entry) => entry.kind === "g").length);
  }

  function renderProgress() {
    const container = $("#pg");
    if (!container) return;
    container.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = "Últimos 30 dias";
    container.append(heading);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = diaryEntries.filter((entry) =>
      Number.isInteger(entry.mood) && new Date(entry.created_at).getTime() >= cutoff
    );
    if (recent.length === 0) {
      const note = document.createElement("p");
      note.className = "em";
      note.textContent = "Ainda não existem registos de estado de espírito nos últimos 30 dias.";
      container.append(note);
      return;
    }
    const counts = moods.map((_, index) => recent.filter((entry) => entry.mood === index).length);
    const max = Math.max(1, ...counts);
    moods.forEach(([label, color], index) => {
      const row = document.createElement("div");
      row.className = "pr";
      const title = document.createElement("span");
      title.textContent = label;
      const bar = document.createElement("div");
      const fill = document.createElement("i");
      fill.style.width = `${(counts[index] / max) * 100}%`;
      fill.style.background = color;
      bar.append(fill);
      const count = document.createElement("b");
      count.textContent = String(counts[index]);
      row.append(title, bar, count);
      container.append(row);
    });
  }

  async function loadDiary() {
    if (!user) return;
    $("#er").textContent = "";
    try {
      const result = await request("/api/diary");
      diaryEntries = result.entries;
      renderDiary();
    } catch (error) {
      $("#er").textContent = error.message;
      if (error.status === 401) await expireSession();
    }
  }

  async function saveEntry() {
    if (!user) {
      requireLogin("#diario");
      return;
    }
    $("#er").textContent = "";
    const text = $("#tx").value.trim();
    if ((diaryKind === "e" || diaryKind === "g") && !text) {
      $("#er").textContent = "Escreve algo antes de guardar.";
      $("#tx").focus();
      return;
    }
    if ((diaryKind === "e" || diaryKind === "m") && selectedMood === null) {
      $("#er").textContent = "Escolhe como te sentes antes de guardar.";
      return;
    }
    const payload = {
      kind: diaryKind,
      mood: diaryKind === "e" || diaryKind === "m" ? selectedMood : null,
      text: diaryKind === "m" ? "" : text,
    };
    const wasEditing = Boolean(editingId);
    const button = $("#sv");
    button.disabled = true;
    try {
      if (editingId) {
        await request(`/api/diary/${encodeURIComponent(editingId)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await request("/api/diary", { method: "POST", body: JSON.stringify(payload) });
      }
      await loadDiary();
      resetEntry();
      showToast(wasEditing ? "Entrada atualizada." : "Entrada guardada na tua conta.");
    } catch (error) {
      $("#er").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function editEntry(id) {
    const entry = diaryEntries.find((item) => item.id === id);
    if (!entry) return;
    editingId = id;
    setDiaryTab(entry.kind);
    selectedMood = entry.mood;
    $$("#moods button").forEach((button, index) => {
      button.setAttribute("aria-checked", String(index === selectedMood));
      button.tabIndex = index === selectedMood ? 0 : -1;
    });
    $("#tx").value = entry.text;
    $("#cn").hidden = false;
    $("#sv").textContent = "Guardar alterações";
    $("#diario").scrollIntoView({ behavior: "smooth" });
    ($("#tx").hidden ? $("#sv") : $("#tx")).focus({ preventScroll: true });
  }

  async function deleteEntry(id) {
    if (!user || !window.confirm("Eliminar esta entrada do teu diário?")) return;
    try {
      await request(`/api/diary/${encodeURIComponent(id)}/delete`, {
        method: "POST",
        body: "{}",
      });
      diaryEntries = diaryEntries.filter((entry) => entry.id !== id);
      if (editingId === id) resetEntry();
      renderDiary();
      showToast("Entrada eliminada.");
    } catch (error) {
      $("#er").textContent = error.message;
    }
  }

  function configurePrivateFeatures() {
    const chatStatus = $("#chatStatus");
    const chatPanel = $("#chatPanel");
    const appointmentStatus = $("#appointmentStatus");
    const appointmentForm = $("#appointmentForm");
    if (chatStatus && chatPanel) {
      chatPanel.hidden = !user || !platform.chatAvailable;
      chatStatus.textContent = !user
        ? "Inicia sessão para verificar se este canal está disponível."
        : platform.chatAvailable
          ? "As mensagens ficam guardadas neste browser; não são enviadas a ninguém."
          : "Indisponível: a equipa ainda não configurou o serviço de mensagens.";
    }
    if (appointmentStatus && appointmentForm) {
      appointmentForm.hidden = !user || !platform.appointmentsAvailable;
      appointmentStatus.textContent = !user
        ? "Inicia sessão para enviar um pedido de consulta."
        : platform.appointmentsAvailable
          ? "O formulário cria apenas um pedido pendente; não consulta uma agenda nem confirma horários."
          : "Indisponível: a equipa ainda não configurou a receção de pedidos.";
    }
  }

  async function loadPlatformStatus() {
    try {
      platform = await request("/api/platform/status");
    } catch {
      platform = { chatAvailable: false, appointmentsAvailable: false, contactAvailable: false };
      $("#contactStatus").textContent = "O servidor da plataforma não está disponível. O formulário não pode ser enviado.";
    }
    configurePrivateFeatures();
    $("#contactForm").hidden = !platform.contactAvailable;
    if (!platform.contactAvailable && !$("#contactStatus").textContent) {
      $("#contactStatus").textContent = "Indisponível: ainda não existe uma equipa configurada para receber pedidos.";
    }
  }

  async function loadChat() {
    if (!user || !platform.chatAvailable) return;
    const list = $("#chatMessages");
    list.replaceChildren();
    try {
      const result = await request("/api/chat/messages");
      if (result.messages.length === 0) {
        const empty = document.createElement("p");
        empty.className = "em";
        empty.textContent = "Ainda não existem mensagens nesta conversa.";
        list.append(empty);
      }
      result.messages.forEach((message) => {
        const item = document.createElement("article");
        item.className = `chat-message ${message.sender === "user" ? "from-user" : ""}`;
        const text = document.createElement("p");
        text.textContent = message.body;
        const date = document.createElement("time");
        date.dateTime = message.created_at;
        date.textContent = `${message.sender === "team" ? "Equipa" : "Tu"} · ${new Date(message.created_at).toLocaleString("pt-PT")}`;
        item.append(text, date);
        list.append(item);
      });
    } catch (error) {
      $("#chatStatus").textContent = error.message;
      if (error.status === 401) await expireSession();
    }
  }

  function initChat() {
    $("#chatForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!user) return requireLogin("#chat");
      const form = event.currentTarget;
      const button = $("button[type=submit]", form);
      $("#chatError").textContent = "";
      button.disabled = true;
      try {
        await request("/api/chat/messages", {
          method: "POST",
          body: JSON.stringify({ body: $("#chatBody").value }),
        });
        form.reset();
        await loadChat();
        showToast("Mensagem guardada nesta demonstração.");
      } catch (error) {
        $("#chatError").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    $("#chatRefresh").addEventListener("click", loadChat);
  }

  function focusAppointment() {
    $("#appointmentDate").focus({ preventScroll: true });
  }

  function initAppointments() {
    const date = $("#appointmentDate");
    const today = new Date();
    date.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    $("#appointmentForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!user) return requireLogin("#marcar");
      $("#appointmentError").textContent = "";
      const button = $("button[type=submit]", event.currentTarget);
      button.disabled = true;
      try {
        const result = await request("/api/appointments", {
          method: "POST",
          body: JSON.stringify({
            preferredDate: date.value,
            preferredTime: $("#appointmentTime").value,
            note: $("#appointmentNote").value,
          }),
        });
        $("#appointmentStatus").textContent = result.notice;
        $("#appointmentStatus").classList.add("appointment-result");
        event.currentTarget.reset();
        date.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      } catch (error) {
        $("#appointmentError").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  function initContactForm() {
    $("#contactForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!platform.contactAvailable) {
        $("#contactError").textContent = "O canal de contacto não está configurado.";
        return;
      }
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      const button = $("button[type=submit]", form);
      $("#contactError").textContent = "";
      button.disabled = true;
      try {
        const result = await request("/api/contact", {
          method: "POST",
          body: JSON.stringify(values),
        });
        $("#contactStatus").textContent = result.notice;
        form.reset();
      } catch (error) {
        $("#contactError").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  async function expireSession() {
    user = null;
    diaryEntries = [];
    authReady = true;
    displayAuthState();
    renderDiary();
    if (protectedTargets.has(location.hash)) {
      sessionStorage.setItem(returnKey, location.hash);
      location.hash = "#entrar";
    }
  }

  async function initialize() {
    document.documentElement.classList.add("js");
    initNavigation();
    initAuth();
    initProtectedNavigation();
    initDiary();
    initChat();
    initAppointments();
    initContactForm();
    await loadPlatformStatus();

    try {
      const result = await request("/api/auth/me");
      user = result.user;
    } catch (error) {
      if (error.status !== 401) {
        $("#authNotice").textContent = error.message;
      }
    }
    authReady = true;
    displayAuthState();
    renderDiary();
    if (user) await loadDiary();
    if (protectedTargets.has(location.hash) && !user) {
      sessionStorage.setItem(returnKey, location.hash);
      location.hash = "#entrar";
    } else if (location.hash === "#chat" && user) {
      await loadChat();
    }
    const hero = $(".art");
    if (hero) setTimeout(() => hero.classList.add("in"), 100);
  }

  initialize();
})();
