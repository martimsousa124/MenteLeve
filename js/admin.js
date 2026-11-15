(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const status = $("#adminStatus");
  const loginPanel = $("#adminLoginPanel");
  const dashboard = $("#adminDashboard");

  async function api(path, options = {}) {
    try {
      return await window.MenteLeveDemo.request(path, options);
    } catch (error) {
      throw new Error(error.message || "Não foi possível concluir o pedido.");
    }
  }

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function showLogin(message = "") {
    loginPanel.hidden = false;
    dashboard.hidden = true;
    $("#adminLoginError").textContent = message;
  }

  async function loadDashboard() {
    status.textContent = "A carregar pedidos…";
    try {
      const data = await api("/api/admin/data");
      renderAppointments(data.appointments);
      renderMessages(data.messages);
      renderContacts(data.contacts);
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message;
      if (error.message.includes("Inicia sessão") || error.message.includes("expirou")) showLogin(error.message);
    }
  }

  function renderAppointments(items) {
    const list = $("#appointmentList");
    list.replaceChildren();
    if (items.length === 0) list.append(node("p", "Não existem pedidos de consulta."));
    items.forEach((item) => {
      const card = node("article", undefined, "admin-card");
      const content = document.createElement("div");
      content.append(
        node("h3", `${item.name} — ${item.preferred_date}`),
        node("p", `${item.email} · ${timeLabel(item.preferred_time)} · ${statusLabel(item.status)}`),
        node("p", item.note || "Sem observações.")
      );
      if (item.status === "pending") {
        const actions = node("div", undefined, "admin-actions");
        actions.append(
          actionButton("Marcar como confirmada", "confirm", item.id),
          actionButton("Recusar pedido", "decline", item.id)
        );
        content.append(actions);
      }
      card.append(content);
      list.append(card);
    });
  }

  function timeLabel(value) {
    return {
      any: "sem preferência de horário",
      morning: "preferência: manhã",
      afternoon: "preferência: tarde",
      evening: "preferência: noite",
    }[value] || value;
  }

  function statusLabel(value) {
    return { pending: "pendente", confirmed: "confirmada", declined: "recusada", handled: "tratado" }[value] || value;
  }

  function actionButton(label, action, id) {
    const button = node("button", label, "btn bo");
    button.type = "button";
    button.dataset.action = action;
    button.dataset.id = id;
    return button;
  }

  function renderMessages(items) {
    const list = $("#messageList");
    list.replaceChildren();
    const conversations = new Map();
    items.forEach((message) => {
      if (!conversations.has(message.user_id)) conversations.set(message.user_id, []);
      conversations.get(message.user_id).push(message);
    });
    if (conversations.size === 0) list.append(node("p", "Não existem mensagens."));
    conversations.forEach((messages, userId) => {
      const newest = messages[0];
      const card = node("article", undefined, "admin-card");
      const content = document.createElement("div");
      content.append(node("h3", `${newest.name} (${newest.email})`));
      messages.slice().reverse().forEach((message) => {
        const item = node(
          "p",
          `${message.sender === "team" ? "Equipa" : newest.name} · ${new Date(message.created_at).toLocaleString("pt-PT")}: ${message.body}`
        );
        content.append(item);
      });
      const form = document.createElement("form");
      const label = node("label", "Resposta da equipa");
      const textarea = document.createElement("textarea");
      textarea.name = "body";
      textarea.maxLength = 4000;
      textarea.required = true;
      const error = node("p", "", "er");
      error.setAttribute("role", "alert");
      const submit = node("button", "Enviar resposta", "btn bp");
      submit.type = "submit";
      form.append(label, textarea, error, submit);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        submit.disabled = true;
        try {
          await api("/api/admin/chat/reply", {
            method: "POST",
            body: JSON.stringify({ userId, body: textarea.value }),
          });
          await loadDashboard();
        } catch (requestError) {
          error.textContent = requestError.message;
        } finally {
          submit.disabled = false;
        }
      });
      content.append(form);
      card.append(content);
      list.append(card);
    });
  }

  function renderContacts(items) {
    const list = $("#contactList");
    list.replaceChildren();
    if (items.length === 0) list.append(node("p", "Não existem pedidos de contacto."));
    items.forEach((item) => {
      const card = node("article", undefined, "admin-card");
      const content = document.createElement("div");
      content.append(
        node("h3", item.subject),
        node("p", `${item.name} · ${item.email} · ${statusLabel(item.status)}`),
        node("p", item.message)
      );
      if (item.status === "pending") {
        const button = actionButton("Marcar como tratado", "handled", item.id);
        content.append(button);
      }
      card.append(content);
      list.append(card);
    });
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    if (action === "confirm" && !window.confirm("Marcar este pedido de demonstração como confirmado? Isto não agenda uma consulta real.")) return;
    if (action === "decline" && !window.confirm("Marcar este pedido de demonstração como recusado?")) return;
    button.disabled = true;
    try {
      if (action === "confirm" || action === "decline") {
        await api("/api/admin/appointments/decide", {
          method: "POST",
          body: JSON.stringify({ requestId: button.dataset.id, status: action === "confirm" ? "confirmed" : "declined" }),
        });
      } else {
        await api("/api/admin/contact/handled", {
          method: "POST",
          body: JSON.stringify({ requestId: button.dataset.id }),
        });
      }
      await loadDashboard();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function init() {
    const resetButton = $("#resetDemo");
    resetButton?.addEventListener("click", () => {
      if (!window.confirm("Isto apaga a conta de utilizador, o diário e todos os pedidos guardados neste browser. Continuar?")) return;
      try {
        window.MenteLeveDemo.reset();
        window.location.reload();
      } catch (error) {
        $("#adminLoginError").textContent = error.message;
      }
    });

    $("#adminLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = $("button[type=submit]", form);
      submit.disabled = true;
      $("#adminLoginError").textContent = "";
      try {
        const result = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: $("#adminEmail").value,
            password: $("#adminPassword").value,
          }),
        });
        if (result.user.role !== "admin") {
          await api("/api/auth/logout", { method: "POST", body: "{}" });
          showLogin("Esta conta não tem permissões de administração.");
          return;
        }
        $("#adminPassword").value = "";
        loginPanel.hidden = true;
        dashboard.hidden = false;
        $("#adminIdentity").textContent = `Admin de demonstração: ${result.user.email}`;
        await loadDashboard();
      } catch (error) {
        $("#adminLoginError").textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    });

    dashboard.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (button) handleAction(button);
    });
    $("#refreshAdmin").addEventListener("click", loadDashboard);
    $("#adminLogout").addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST", body: "{}" });
        showLogin();
      } catch (error) {
        status.textContent = error.message;
      }
    });

    api("/api/auth/me")
      .then(({ user }) => {
        if (user.role !== "admin") {
          showLogin("Esta conta não tem permissões de administração.");
          return;
        }
        loginPanel.hidden = true;
        dashboard.hidden = false;
        $("#adminIdentity").textContent = `Admin de demonstração: ${user.email}`;
        return loadDashboard();
      })
      .catch((error) => showLogin(error.message));
  }

  init();
})();
