(() => {
  "use strict";

  const dataKey = "mente-leve-school-demo:v1";
  const sessionKey = "mente-leve-school-demo:session";
  const adminEmail = "admin@gmail.com";
  const adminPassword = "admin123";

  class DemoError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }

  function emptyState() {
    return { users: [], entries: [], messages: [], appointments: [], contacts: [] };
  }

  function readState() {
    try {
      const saved = localStorage.getItem(dataKey);
      if (!saved) return emptyState();
      const state = JSON.parse(saved);
      if (
        !state ||
        !Array.isArray(state.users) ||
        !Array.isArray(state.entries) ||
        !Array.isArray(state.messages) ||
        !Array.isArray(state.appointments) ||
        !Array.isArray(state.contacts)
      ) {
        throw new DemoError("Os dados locais da demonstração não são válidos. Reinicia a demonstração.", 500);
      }
      return state;
    } catch (error) {
      if (error instanceof DemoError) throw error;
      throw new DemoError("O navegador não conseguiu ler os dados locais desta demonstração.", 0);
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(dataKey, JSON.stringify(state));
    } catch {
      throw new DemoError("O navegador não conseguiu guardar os dados. Verifica o espaço disponível.", 0);
    }
  }

  function makeId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function randomSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function passwordHash(password, salt) {
    if (!crypto.subtle) throw new DemoError("Este navegador não suporta a demonstração de contas.", 0);
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 120000 },
      material,
      256
    );
    return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function publicUser(user) {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }

  function adminUser() {
    return { id: "school-demo-admin", name: "Admin Mente Leve", email: adminEmail, role: "admin" };
  }

  function currentUser(state) {
    let id;
    try {
      id = localStorage.getItem(sessionKey);
    } catch {
      throw new DemoError("O navegador não conseguiu ler a sessão local.", 0);
    }
    if (id === "school-demo-admin") return adminUser();
    const user = state.users.find((item) => item.id === id);
    if (!user) throw new DemoError("Inicia sessão para continuar.", 401);
    return publicUser(user);
  }

  function requireAdmin(state) {
    const user = currentUser(state);
    if (user.role !== "admin") throw new DemoError("Esta conta não tem permissões de administração.", 403);
    return user;
  }

  function requireUser(state) {
    const user = currentUser(state);
    if (user.role !== "user") throw new DemoError("Inicia sessão com a tua conta de utilizador.", 403);
    return user;
  }

  function getBody(options) {
    if (!options.body) return {};
    try {
      return JSON.parse(options.body);
    } catch {
      throw new DemoError("O formulário contém dados inválidos.");
    }
  }

  function cleanText(value, label, maxLength, required = true) {
    if (typeof value !== "string") throw new DemoError(`Indica ${label}.`);
    const cleaned = value.trim();
    if (required && !cleaned) throw new DemoError(`Indica ${label}.`);
    if (cleaned.length > maxLength) throw new DemoError(`${label} excede o limite permitido.`);
    return cleaned;
  }

  function persistSession(id) {
    try {
      localStorage.setItem(sessionKey, id);
    } catch {
      throw new DemoError("O navegador não conseguiu guardar a sessão local.", 0);
    }
  }

  async function request(path, options = {}) {
    const method = options.method || "GET";
    const body = getBody(options);
    const state = readState();

    if (path === "/api/platform/status" && method === "GET") {
      return { chatAvailable: true, appointmentsAvailable: true, contactAvailable: true };
    }

    if (path === "/api/auth/me" && method === "GET") {
      return { user: currentUser(state) };
    }

    if (path === "/api/auth/register" && method === "POST") {
      const name = cleanText(body.name, "o teu nome", 100);
      const email = cleanText(body.email, "um email", 254).toLowerCase();
      const password = cleanText(body.password, "uma palavra-passe", 256);
      if (password.length < 12) throw new DemoError("A palavra-passe tem de ter pelo menos 12 caracteres.");
      if (email === adminEmail) throw new DemoError("Este email está reservado para a conta de administração.");
      if (state.users.length) throw new DemoError("Esta demonstração permite apenas uma conta de utilizador.");

      const salt = randomSalt();
      const user = {
        id: makeId(),
        name,
        email,
        role: "user",
        passwordSalt: salt,
        passwordHash: await passwordHash(password, salt),
      };
      state.users.push(user);
      writeState(state);
      persistSession(user.id);
      return { user: publicUser(user) };
    }

    if (path === "/api/auth/login" && method === "POST") {
      const email = cleanText(body.email, "um email", 254).toLowerCase();
      const password = cleanText(body.password, "a palavra-passe", 256);
      if (email === adminEmail) {
        const valid = (await passwordHash(password, "mente-leve-school-demo-admin")) ===
          (await passwordHash(adminPassword, "mente-leve-school-demo-admin"));
        if (!valid) throw new DemoError("Email ou palavra-passe incorretos.", 401);
        persistSession("school-demo-admin");
        return { user: adminUser() };
      }

      const user = state.users.find((item) => item.email === email);
      const hash = user
        ? await passwordHash(password, user.passwordSalt)
        : await passwordHash(password, "mente-leve-school-demo-unknown");
      if (!user || hash !== user.passwordHash) throw new DemoError("Email ou palavra-passe incorretos.", 401);
      persistSession(user.id);
      return { user: publicUser(user) };
    }

    if (path === "/api/auth/logout" && method === "POST") {
      try {
        localStorage.removeItem(sessionKey);
      } catch {
        throw new DemoError("O navegador não conseguiu terminar a sessão local.", 0);
      }
      return { ok: true };
    }

    if (path === "/api/auth/password-reset" && method === "POST") {
      throw new DemoError("A recuperação de palavra-passe não está disponível nesta demonstração.", 503);
    }

    if (path === "/api/diary" && method === "GET") {
      const user = requireUser(state);
      return { entries: state.entries.filter((entry) => entry.user_id === user.id) };
    }

    if (path === "/api/diary" && method === "POST") {
      const user = requireUser(state);
      const kind = body.kind;
      if (!["e", "m", "g"].includes(kind)) throw new DemoError("Escolhe uma secção válida do diário.");
      const mood = body.mood ?? null;
      if (mood !== null && (!Number.isInteger(mood) || mood < 0 || mood > 4)) {
        throw new DemoError("O estado de espírito selecionado não é válido.");
      }
      const text = cleanText(body.text ?? "", "um texto", 3000, false);
      if ((kind === "e" || kind === "g") && !text) throw new DemoError("Escreve algo antes de guardar.");
      if (kind === "m" && mood === null) throw new DemoError("Escolhe como te sentes antes de guardar.");
      const now = new Date().toISOString();
      const entry = {
        id: makeId(),
        user_id: user.id,
        kind,
        mood,
        text,
        created_at: now,
        updated_at: now,
      };
      state.entries.push(entry);
      writeState(state);
      return { entry };
    }

    const diaryEdit = path.match(/^\/api\/diary\/([^/]+)$/);
    if (diaryEdit && method === "PUT") {
      const user = requireUser(state);
      const entry = state.entries.find((item) => item.id === decodeURIComponent(diaryEdit[1]) && item.user_id === user.id);
      if (!entry) throw new DemoError("A entrada não existe.", 404);
      const kind = body.kind;
      if (!["e", "m", "g"].includes(kind)) throw new DemoError("Escolhe uma secção válida do diário.");
      const mood = body.mood ?? null;
      const text = cleanText(body.text ?? "", "um texto", 3000, false);
      if ((kind === "e" || kind === "g") && !text) throw new DemoError("Escreve algo antes de guardar.");
      if (kind === "m" && (!Number.isInteger(mood) || mood < 0 || mood > 4)) {
        throw new DemoError("Escolhe como te sentes antes de guardar.");
      }
      Object.assign(entry, { kind, mood, text, updated_at: new Date().toISOString() });
      writeState(state);
      return { entry };
    }

    const diaryDelete = path.match(/^\/api\/diary\/([^/]+)\/delete$/);
    if (diaryDelete && method === "POST") {
      const user = requireUser(state);
      const entryId = decodeURIComponent(diaryDelete[1]);
      const filtered = state.entries.filter((item) => item.id !== entryId || item.user_id !== user.id);
      if (filtered.length === state.entries.length) throw new DemoError("A entrada não existe.", 404);
      state.entries = filtered;
      writeState(state);
      return { ok: true };
    }

    if (path === "/api/chat/messages" && method === "GET") {
      const user = requireUser(state);
      return { messages: state.messages.filter((item) => item.user_id === user.id) };
    }

    if (path === "/api/chat/messages" && method === "POST") {
      const user = requireUser(state);
      const message = {
        id: makeId(),
        user_id: user.id,
        sender: "user",
        body: cleanText(body.body, "uma mensagem", 4000),
        created_at: new Date().toISOString(),
      };
      state.messages.push(message);
      writeState(state);
      return { message, notice: "Mensagem guardada nesta demonstração." };
    }

    if (path === "/api/appointments" && method === "POST") {
      const user = requireUser(state);
      const preferredDate = cleanText(body.preferredDate, "uma data pretendida", 10);
      if (Number.isNaN(Date.parse(`${preferredDate}T00:00:00`))) throw new DemoError("Indica uma data válida.");
      if (!["morning", "afternoon", "evening", "any"].includes(body.preferredTime)) {
        throw new DemoError("Escolhe uma preferência de horário válida.");
      }
      const appointment = {
        id: makeId(),
        user_id: user.id,
        name: user.name,
        email: user.email,
        preferred_date: preferredDate,
        preferred_time: body.preferredTime,
        note: cleanText(body.note ?? "", "uma observação", 1000, false),
        status: "pending",
        created_at: new Date().toISOString(),
      };
      state.appointments.push(appointment);
      writeState(state);
      return {
        request: { id: appointment.id, status: appointment.status, created_at: appointment.created_at },
        notice: "Pedido de demonstração guardado neste browser; não corresponde a uma consulta real.",
      };
    }

    if (path === "/api/contact" && method === "POST") {
      const user = (() => {
        try {
          return currentUser(state);
        } catch (error) {
          if (error.status === 401) return null;
          throw error;
        }
      })();
      const contact = {
        id: makeId(),
        user_id: user?.id || null,
        name: cleanText(body.name, "o teu nome", 100),
        email: cleanText(body.email, "um email", 254).toLowerCase(),
        subject: cleanText(body.subject, "um assunto", 120),
        message: cleanText(body.message, "uma mensagem", 4000),
        status: "pending",
        created_at: new Date().toISOString(),
      };
      state.contacts.push(contact);
      writeState(state);
      return {
        request: { id: contact.id, status: contact.status, created_at: contact.created_at },
        notice: "Pedido de demonstração guardado neste browser; não foi enviado.",
      };
    }

    if (path === "/api/admin/data" && method === "GET") {
      requireAdmin(state);
      const messages = [...state.messages].reverse().map((message) => {
        const owner = state.users.find((item) => item.id === message.user_id);
        if (!owner) throw new DemoError("Não foi possível encontrar a conta associada a uma conversa.", 500);
        return { ...message, name: owner.name, email: owner.email };
      });
      return {
        appointments: [...state.appointments].reverse(),
        messages,
        contacts: [...state.contacts].reverse(),
      };
    }

    if (path === "/api/admin/chat/reply" && method === "POST") {
      requireAdmin(state);
      const userId = cleanText(body.userId, "uma conversa", 100);
      if (!state.users.some((item) => item.id === userId)) throw new DemoError("A conversa não existe.", 404);
      const message = {
        id: makeId(),
        user_id: userId,
        sender: "team",
        body: cleanText(body.body, "uma resposta", 4000),
        created_at: new Date().toISOString(),
      };
      state.messages.push(message);
      writeState(state);
      return { message };
    }

    if (path === "/api/admin/appointments/decide" && method === "POST") {
      requireAdmin(state);
      const appointment = state.appointments.find((item) => item.id === body.requestId);
      if (!appointment) throw new DemoError("O pedido não existe.", 404);
      if (!["confirmed", "declined"].includes(body.status)) throw new DemoError("Escolhe uma decisão válida.");
      appointment.status = body.status;
      writeState(state);
      return { ok: true, status: appointment.status };
    }

    if (path === "/api/admin/contact/handled" && method === "POST") {
      requireAdmin(state);
      const contact = state.contacts.find((item) => item.id === body.requestId);
      if (!contact) throw new DemoError("O pedido não existe.", 404);
      contact.status = "handled";
      writeState(state);
      return { ok: true, status: contact.status };
    }

    throw new DemoError("Esta função não está disponível na demonstração.", 404);
  }

  function reset() {
    try {
      localStorage.removeItem(dataKey);
      localStorage.removeItem(sessionKey);
    } catch {
      throw new DemoError("O navegador não conseguiu limpar os dados locais.", 0);
    }
  }

  window.MenteLeveDemo = { request, reset };
})();
