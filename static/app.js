const state = { groups: [], cards: [], filter: null, editing: null, search: "" };

const PEN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

// Alphabetical by title, ignoring case and accents, with "Card 2" before "Card 10".
const titleOrder = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const $ = (id) => document.getElementById(id);
const els = {
  cardForm: $("card-form"),
  cardTitle: $("card-title"),
  cardBody: $("card-body"),
  cardGroup: $("card-group"),
  cardFormTitle: $("card-form-title"),
  cardSubmit: $("card-submit"),
  cardCancel: $("card-cancel"),
  groupForm: $("group-form"),
  groupName: $("group-name"),
  groupList: $("group-list"),
  cards: $("cards"),
  empty: $("empty"),
  contentTitle: $("content-title"),
  contentCount: $("content-count"),
  search: $("search"),
  themeToggle: $("theme-toggle"),
  themeLabel: $("theme-label"),
  toast: $("toast"),
  restoreStart: $("restore-start"),
  restoreFile: $("restore-file"),
  quizStart: $("quiz-start"),
  quiz: $("quiz"),
  quizProgress: $("quiz-progress"),
  quizClose: $("quiz-close"),
  quizQuestion: $("quiz-question"),
  quizPrompt: $("quiz-prompt"),
  quizOptions: $("quiz-options"),
  quizScore: $("quiz-score"),
  quizNext: $("quiz-next"),
  quizResults: $("quiz-results"),
  quizFinal: $("quiz-final"),
  quizMessage: $("quiz-message"),
  quizDone: $("quiz-done"),
  quizAgain: $("quiz-again"),
};

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 3500);
}

async function refresh() {
  [state.groups, state.cards] = await Promise.all([
    api("GET", "/api/groups"),
    api("GET", "/api/cards"),
  ]);
  state.cards.sort((a, b) => titleOrder.compare(a.title, b.title) || a.id - b.id);
  if (!state.groups.some((g) => g.id === state.filter)) state.filter = null;
  if (state.editing !== null && !state.cards.some((c) => c.id === state.editing)) {
    stopEditing();
  }
  render();
}

function startEditing(card) {
  state.editing = card.id;
  els.cardTitle.value = card.title;
  els.cardBody.value = card.body;
  els.cardGroup.value = card.group_id;
  els.cardFormTitle.textContent = "Edit flashcard";
  els.cardSubmit.textContent = "Save changes";
  els.cardCancel.hidden = false;
  renderCards();
  els.cardForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  els.cardTitle.focus({ preventScroll: true });
}

function stopEditing() {
  state.editing = null;
  els.cardTitle.value = "";
  els.cardBody.value = "";
  els.cardFormTitle.textContent = "New flashcard";
  els.cardSubmit.textContent = "Save flashcard";
  els.cardCancel.hidden = true;
}

function render() {
  renderGroupSelect();
  renderGroupList();
  renderCards();
}

function renderGroupSelect() {
  // Groups arrive with Default first, so it is the initial selection.
  const previous = els.cardGroup.value;
  els.cardGroup.replaceChildren(
    ...state.groups.map((g) => el("option", { value: g.id, textContent: g.name }))
  );
  if (state.groups.some((g) => String(g.id) === previous)) {
    els.cardGroup.value = previous;
  }
}

function groupButton(label, count, groupId) {
  const active = state.filter === groupId;
  const button = el(
    "button",
    { type: "button", className: "group-item" + (active ? " active" : "") },
    el("span", { className: "name", textContent: label }),
    el("span", { className: "count", textContent: count })
  );
  button.setAttribute("aria-pressed", active);
  button.addEventListener("click", () => {
    state.filter = groupId;
    render();
  });
  return button;
}

function renderGroupList() {
  const rows = [
    el(
      "li",
      { className: "group-row" },
      groupButton("All flashcards", state.cards.length, null),
      el("span", { className: "icon-spacer" })
    ),
  ];

  for (const group of state.groups) {
    const row = el("li", { className: "group-row" }, groupButton(group.name, group.count, group.id));
    if (group.name === "Default") {
      row.append(el("span", { className: "icon-spacer" }));
    } else {
      const remove = el("button", {
        type: "button",
        className: "icon-btn",
        textContent: "×",
        title: `Delete group "${group.name}"`,
      });
      remove.setAttribute("aria-label", `Delete group ${group.name}`);
      remove.addEventListener("click", () => deleteGroup(group));
      row.append(remove);
    }
    rows.push(row);
  }
  els.groupList.replaceChildren(...rows);
}

// Cards in the selected group that match the search (case-insensitive, title and body).
function visibleCards() {
  const query = state.search.trim().toLowerCase();
  return state.cards.filter(
    (c) =>
      (state.filter === null || c.group_id === state.filter) &&
      (!query || c.title.toLowerCase().includes(query) || c.body.toLowerCase().includes(query))
  );
}

function renderCards() {
  const group = state.groups.find((g) => g.id === state.filter);
  const query = state.search.trim();
  const visible = visibleCards();

  const playable = quizPool(visible).length >= QUIZ_CHOICES;
  els.quizStart.disabled = !playable;
  els.quizStart.title = playable
    ? "Test yourself on the flashcards shown"
    : `The quiz needs at least ${QUIZ_CHOICES} flashcards with different titles`;

  els.contentTitle.textContent = group ? group.name : "All flashcards";
  els.contentCount.textContent = `${visible.length} ${visible.length === 1 ? "card" : "cards"}`;
  els.cards.replaceChildren(...visible.map(cardNode));

  els.empty.hidden = visible.length > 0;
  if (query) {
    els.empty.textContent = `No flashcards match "${query}".`;
  } else if (group) {
    els.empty.textContent = "No flashcards in this group yet.";
  } else {
    els.empty.textContent = "No flashcards yet. Add your first one to get started.";
  }
}

function cardNode(card) {
  const flip = el(
    "div",
    { className: "card-flip", tabIndex: 0 },
    el(
      "div",
      { className: "face front" },
      el("span", { className: "badge", textContent: card.group_name }),
      el("div", { className: "card-title", textContent: card.title }),
      el("span", { className: "hint", textContent: "Click to flip" })
    ),
    el(
      "div",
      { className: "face back" },
      el("p", { className: "card-body", textContent: card.body })
    )
  );
  flip.setAttribute("role", "button");
  flip.setAttribute("aria-label", `Flashcard: ${card.title}. Press to flip.`);

  const edit = el("button", {
    type: "button",
    className: "icon-btn edit",
    innerHTML: PEN_ICON,
    title: "Edit flashcard",
  });
  edit.setAttribute("aria-label", `Edit flashcard ${card.title}`);
  edit.addEventListener("click", () => startEditing(card));

  const remove = el("button", {
    type: "button",
    className: "icon-btn delete",
    textContent: "×",
    title: "Delete flashcard",
  });
  remove.setAttribute("aria-label", `Delete flashcard ${card.title}`);

  const node = el(
    "article",
    { className: "card" + (card.id === state.editing ? " editing" : "") },
    flip,
    el("div", { className: "card-actions" }, edit, remove)
  );

  const toggle = () => node.classList.toggle("flipped");
  flip.addEventListener("click", toggle);
  flip.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });
  remove.addEventListener("click", () => deleteCard(card));

  return node;
}

async function deleteCard(card) {
  if (!confirm(`Delete "${card.title}"?`)) return;
  try {
    await api("DELETE", `/api/cards/${card.id}`);
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteGroup(group) {
  const note = group.count ? ` Its ${group.count} card(s) will move to Default.` : "";
  if (!confirm(`Delete the group "${group.name}"?${note}`)) return;
  try {
    await api("DELETE", `/api/groups/${group.id}`);
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

els.cardForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const fields = {
      title: els.cardTitle.value,
      body: els.cardBody.value,
      group_id: Number(els.cardGroup.value),
    };
    if (state.editing !== null) {
      await api("PUT", `/api/cards/${state.editing}`, fields);
    } else {
      await api("POST", "/api/cards", fields);
    }
    stopEditing();
    els.cardTitle.focus();
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

els.cardCancel.addEventListener("click", () => {
  stopEditing();
  renderCards();
});

els.groupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const group = await api("POST", "/api/groups", { name: els.groupName.value });
    els.groupName.value = "";
    await refresh();
    els.cardGroup.value = group.id;
  } catch (err) {
    toast(err.message);
  }
});

/* ---------- Backup ---------- */

els.restoreStart.addEventListener("click", () => els.restoreFile.click());

els.restoreFile.addEventListener("change", async () => {
  const file = els.restoreFile.files[0];
  els.restoreFile.value = ""; // so choosing the same file again still fires "change"
  if (!file) return;
  try {
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch (e) {
      throw new Error("That file is not a flashcards backup.");
    }
    const count = Array.isArray(backup.cards) ? backup.cards.length : 0;
    const current = state.cards.length;
    if (!confirm(
      `Restore ${count} flashcard(s) from "${file.name}"? ` +
      `This replaces all ${current} current flashcard(s) and groups.`
    )) return;
    const result = await api("POST", "/api/restore", backup);
    stopEditing();
    await refresh();
    toast(`Restored ${result.cards} flashcard(s) in ${result.groups} group(s).`);
  } catch (err) {
    toast(err.message);
  }
});

/* ---------- Quiz ---------- */

const QUIZ_CHOICES = 4;
const QUIZ_LENGTH = 10;
const PROMPT_LIMIT = 280;
const quiz = { questions: [], index: 0, score: 0, answered: false };

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// One card per title, so no question can have two identical-looking answers.
function quizPool(cards) {
  const seen = new Set();
  return cards.filter((card) => {
    const key = card.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// An excerpt of the card's back, with the answer blanked out if the body repeats it.
function promptText(card) {
  const escaped = card.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = card.body.replace(new RegExp(escaped, "gi"), "_____");
  return text.length > PROMPT_LIMIT ? text.slice(0, PROMPT_LIMIT).trimEnd() + "…" : text;
}

function startQuiz() {
  const pool = quizPool(visibleCards());
  if (pool.length < QUIZ_CHOICES) return;

  quiz.questions = shuffle(pool)
    .slice(0, QUIZ_LENGTH)
    .map((card) => {
      const others = shuffle(pool.filter((c) => c !== card)).slice(0, QUIZ_CHOICES - 1);
      return { card, options: shuffle([card, ...others]) };
    });
  quiz.index = 0;
  quiz.score = 0;

  els.quizResults.hidden = true;
  els.quizQuestion.hidden = false;
  if (!els.quiz.open) els.quiz.showModal();
  renderQuestion();
}

function renderQuestion() {
  const { card, options } = quiz.questions[quiz.index];
  quiz.answered = false;

  els.quizProgress.textContent = `Question ${quiz.index + 1} of ${quiz.questions.length}`;
  els.quizScore.textContent = `Score: ${quiz.score}`;
  els.quizPrompt.textContent = promptText(card);
  els.quizNext.hidden = true;

  els.quizOptions.replaceChildren(
    ...options.map((option, i) => {
      const button = el(
        "button",
        { type: "button", className: "quiz-option" },
        el("span", { className: "key", textContent: i + 1 }),
        el("span", { textContent: option.title })
      );
      button.addEventListener("click", () => answer(i));
      return button;
    })
  );
  els.quizOptions.firstElementChild.focus();
}

function answer(choice) {
  if (quiz.answered) return;
  quiz.answered = true;

  const { card, options } = quiz.questions[quiz.index];
  if (options[choice] === card) quiz.score++;

  [...els.quizOptions.children].forEach((button, i) => {
    button.disabled = true;
    if (options[i] === card) button.classList.add("correct");
    else if (i === choice) button.classList.add("wrong");
  });

  const last = quiz.index === quiz.questions.length - 1;
  els.quizScore.textContent = `Score: ${quiz.score}`;
  els.quizNext.textContent = last ? "See results" : "Next question";
  els.quizNext.hidden = false;
  els.quizNext.focus();
}

function showResults() {
  const total = quiz.questions.length;
  const ratio = quiz.score / total;
  els.quizProgress.textContent = "Finished";
  els.quizFinal.textContent = `${quiz.score} / ${total}`;
  els.quizMessage.textContent =
    ratio === 1 ? "Perfect score!" :
    ratio >= 0.7 ? "Great work!" :
    ratio >= 0.4 ? "Not bad. Keep practising." :
    "Keep going. Practice makes perfect.";
  els.quizQuestion.hidden = true;
  els.quizResults.hidden = false;
  els.quizAgain.focus();
}

els.quizStart.addEventListener("click", startQuiz);
els.quizAgain.addEventListener("click", startQuiz);
els.quizClose.addEventListener("click", () => els.quiz.close());
els.quizDone.addEventListener("click", () => els.quiz.close());

els.quizNext.addEventListener("click", () => {
  quiz.index++;
  if (quiz.index < quiz.questions.length) renderQuestion();
  else showResults();
});

// Keys 1–4 pick an answer.
els.quiz.addEventListener("keydown", (event) => {
  const choice = Number(event.key) - 1;
  if (!els.quizQuestion.hidden && !quiz.answered && choice >= 0 && choice < QUIZ_CHOICES) {
    answer(choice);
  }
});

els.search.addEventListener("input", () => {
  state.search = els.search.value;
  renderCards();
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === "dark";
  els.themeLabel.textContent = dark ? "Light mode" : "Dark mode";
  els.themeToggle.setAttribute("aria-pressed", dark);
}

els.themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("theme", next);
  } catch (e) {}
});

applyTheme(document.documentElement.dataset.theme);
refresh().catch((err) => toast(err.message));
