'use strict';

// ==========================================================================
// Kanban Task Manager — lógica da aplicação
// Depende de icons.js (função svg) carregado antes deste arquivo.
// ==========================================================================

// ---------- Configuração ----------
const STORAGE_KEY = 'kanban_tasks';
const THEME_KEY = 'kanban_theme';
const SORT_KEY = 'kanban_sort';

const STATUSES = ['todo', 'doing', 'done'];
const STATUS_LABELS = { todo: 'A Fazer', doing: 'Em Progresso', done: 'Concluído' };
const PRIORITIES = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const PRIORITY_RANK = { alta: 0, media: 1, baixa: 2 };
const SORT_MODES = ['manual', 'priority', 'due'];
const MAX_CHECKLIST_ITEMS = 30;

const EMPTY_MESSAGES = {
    todo: 'Nenhuma tarefa a fazer. Adicione uma nova tarefa acima.',
    doing: 'Nada em andamento. Mova uma tarefa para cá.',
    done: 'Nenhuma tarefa concluída ainda.'
};

// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);

function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(iso, short = false) {
    const [y, m, d] = iso.split('-');
    return short ? `${d}/${m}` : `${d}/${m}/${y}`;
}

let idSeq = 0;
function newId() {
    return Date.now() * 1000 + (idSeq++ % 1000);
}

function plural(n, singular, pluralForm) {
    return `${n} ${n === 1 ? singular : pluralForm}`;
}

// ---------- Referências do DOM ----------
const lists = { todo: $('todoList'), doing: $('doingList'), done: $('doneList') };
const counts = { todo: $('todoCount'), doing: $('doingCount'), done: $('doneCount') };
const searchInput = $('searchInput');
const filterPriority = $('filterPriority');
const sortSelect = $('sortSelect');
const dialog = $('taskDialog');

// ==========================================================================
// Estado e persistência (LocalStorage)
// ==========================================================================
function normalizeChecklist(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((i) => i && typeof i.text === 'string' && i.text.trim())
        .slice(0, MAX_CHECKLIST_ITEMS)
        .map((i) => ({
            id: Number.isFinite(Number(i.id)) ? Number(i.id) : newId(),
            text: i.text.trim().slice(0, 100),
            done: Boolean(i.done)
        }));
}

function normalizeTask(t) {
    if (!t || typeof t.text !== 'string' || !t.text.trim()) return null;
    const id = Number(t.id);
    return {
        id: Number.isFinite(id) ? id : newId(),
        text: t.text.trim().slice(0, 120),
        status: STATUSES.includes(t.status) ? t.status : 'todo',
        priority: Object.keys(PRIORITIES).includes(t.priority) ? t.priority : 'media',
        due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '',
        notes: typeof t.notes === 'string' ? t.notes.trim().slice(0, 500) : '',
        checklist: normalizeChecklist(t.checklist)
    };
}

function normalizeList(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.map(normalizeTask).filter(Boolean).map((t) => {
        if (seen.has(t.id)) t.id = newId();
        seen.add(t.id);
        return t;
    });
}

function loadTasks() {
    try {
        return normalizeList(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch (err) {
        return [];
    }
}

let tasks = loadTasks();
let snapshot = null;
let editingId = null;
let toastTimer = null;

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (err) {
        showToast('Não foi possível salvar os dados neste navegador.');
    }
    render();
}

function cloneTasks() {
    return tasks.map((t) => ({ ...t, checklist: t.checklist.map((i) => ({ ...i })) }));
}

// ==========================================================================
// Ações sobre as tarefas
// ==========================================================================
function addTask(text, priority, due) {
    tasks.push({ id: newId(), text, status: 'todo', priority, due, notes: '', checklist: [] });
    save();
}

function moveTask(id, status, beforeId = null) {
    const index = tasks.findIndex((t) => t.id === id);
    if (index === -1) return;
    const [task] = tasks.splice(index, 1);
    task.status = status;
    const target = beforeId !== null ? tasks.findIndex((t) => t.id === beforeId) : -1;
    if (target > -1) tasks.splice(target, 0, task);
    else tasks.push(task);
    save();
}

function deleteTask(id) {
    snapshot = cloneTasks();
    tasks = tasks.filter((t) => t.id !== id);
    save();
    showToast('Tarefa excluída.', true);
}

function clearDone() {
    const total = tasks.filter((t) => t.status === 'done').length;
    if (!total) {
        showToast('Não há tarefas concluídas para limpar.');
        return;
    }
    snapshot = cloneTasks();
    tasks = tasks.filter((t) => t.status !== 'done');
    save();
    showToast(`${plural(total, 'tarefa concluída removida', 'tarefas concluídas removidas')}.`, true);
}

function undo() {
    if (!snapshot) return;
    tasks = snapshot;
    snapshot = null;
    hideToast();
    save();
}

// ---------- Edição rápida do título (duplo clique) ----------
function startEdit(id) {
    editingId = id;
    render();
}

function finishEdit(id, value, commit) {
    if (editingId !== id) return;
    editingId = null;
    const text = value.trim();
    if (commit && text) {
        const task = tasks.find((t) => t.id === id);
        if (task) task.text = text.slice(0, 120);
        save();
    } else {
        render();
    }
}

// ==========================================================================
// Aviso (toast)
// ==========================================================================
function showToast(message, withUndo = false) {
    $('toastMsg').textContent = message;
    $('toastUndo').hidden = !withUndo;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
    $('toast').hidden = true;
    clearTimeout(toastTimer);
}

// ==========================================================================
// Painel de detalhes (descrição + checklist)
// ==========================================================================
let draft = null; // cópia de trabalho: { id, checklist }

function openDialog() {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
}

function closeDialog() {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    draft = null;
}

function openDetails(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    draft = { id, checklist: task.checklist.map((i) => ({ ...i })) };
    $('detailText').value = task.text;
    $('detailPriority').value = task.priority;
    $('detailDue').value = task.due;
    $('detailNotes').value = task.notes;
    $('checklistInput').value = '';
    renderChecklist();
    openDialog();
    $('detailText').focus();
}

function renderChecklist() {
    const listEl = $('checklistList');
    listEl.replaceChildren();

    draft.checklist.forEach((item) => {
        const row = el('li', `checklist-item${item.done ? ' is-checked' : ''}`);

        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.done;
        checkbox.setAttribute('aria-label', `Concluir item: ${item.text}`);
        checkbox.addEventListener('change', () => {
            item.done = checkbox.checked;
            renderChecklist();
        });

        const label = el('span');
        label.textContent = item.text;

        const remove = el('button', 'btn-action btn-delete');
        remove.type = 'button';
        remove.title = 'Remover item';
        remove.setAttribute('aria-label', `Remover item: ${item.text}`);
        remove.innerHTML = svg('x', 14);
        remove.addEventListener('click', () => {
            draft.checklist = draft.checklist.filter((i) => i.id !== item.id);
            renderChecklist();
        });

        row.append(checkbox, label, remove);
        listEl.appendChild(row);
    });

    const total = draft.checklist.length;
    const done = draft.checklist.filter((i) => i.done).length;
    $('checklistProgress').textContent = total ? `${done} de ${plural(total, 'item', 'itens')}` : 'Nenhum item';
    $('checklistBar').style.width = `${total ? (done / total) * 100 : 0}%`;
}

function addChecklistItem() {
    const input = $('checklistInput');
    const text = input.value.trim();
    if (!text || !draft || draft.checklist.length >= MAX_CHECKLIST_ITEMS) return;
    draft.checklist.push({ id: newId(), text: text.slice(0, 100), done: false });
    input.value = '';
    renderChecklist();
    input.focus();
}

function saveDetails() {
    if (!draft) return;
    const task = tasks.find((t) => t.id === draft.id);
    const text = $('detailText').value.trim();
    if (!task || !text) return;
    task.text = text.slice(0, 120);
    task.priority = $('detailPriority').value;
    task.due = $('detailDue').value;
    task.notes = $('detailNotes').value.trim().slice(0, 500);
    task.checklist = draft.checklist;
    closeDialog();
    save();
}

// ==========================================================================
// Renderização
// ==========================================================================
function actionButton(label, icon, onClick, extraClass = '') {
    const btn = el('button', `btn-action ${extraClass}`.trim());
    btn.type = 'button';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = svg(icon, 16);
    btn.addEventListener('click', onClick);
    return btn;
}

function dueState(task) {
    if (!task.due || task.status === 'done') return '';
    const today = todayStr();
    if (task.due < today) return 'overdue';
    if (task.due === today) return 'today';
    return '';
}

function chip(icon, text, className = '', title = '') {
    const node = el('span', `chip ${className}`.trim());
    node.innerHTML = svg(icon, 13);
    node.appendChild(document.createTextNode(text));
    if (title) node.title = title;
    return node;
}

function createCard(task) {
    const isEditing = editingId === task.id;
    const card = el('article', `task-card priority-${task.priority}${task.status === 'done' ? ' is-done' : ''}`);
    card.dataset.id = task.id;
    card.draggable = !isEditing;

    // Título (texto ou campo de edição rápida)
    if (isEditing) {
        const input = el('input', 'edit-input');
        input.type = 'text';
        input.maxLength = 120;
        input.value = task.text;
        input.setAttribute('aria-label', 'Renomear tarefa');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') finishEdit(task.id, input.value, true);
            if (e.key === 'Escape') finishEdit(task.id, input.value, false);
        });
        input.addEventListener('blur', () => finishEdit(task.id, input.value, true));
        card.appendChild(input);
    } else {
        const text = el('p', 'task-text');
        text.textContent = task.text;
        text.title = 'Dê dois cliques para renomear';
        text.addEventListener('dblclick', () => startEdit(task.id));
        card.appendChild(text);
    }

    // Progresso do checklist no cartão
    if (task.checklist.length) {
        const bar = el('div', 'mini-progress');
        const fill = el('span');
        const doneItems = task.checklist.filter((i) => i.done).length;
        fill.style.width = `${(doneItems / task.checklist.length) * 100}%`;
        bar.appendChild(fill);
        card.appendChild(bar);
    }

    // Metadados
    const footer = el('div', 'task-footer');
    const meta = el('div', 'task-meta');

    const badge = el('span', 'badge');
    badge.textContent = PRIORITIES[task.priority];
    badge.title = `Prioridade ${PRIORITIES[task.priority].toLowerCase()}`;
    meta.appendChild(badge);

    if (task.due) {
        const state = dueState(task);
        let label = formatDate(task.due);
        if (state === 'overdue') label = `Atrasada (${formatDate(task.due, true)})`;
        if (state === 'today') label = 'Vence hoje';
        meta.appendChild(chip('calendar', label, state, `Prazo: ${formatDate(task.due)}`));
    }

    if (task.checklist.length) {
        const doneItems = task.checklist.filter((i) => i.done).length;
        const complete = doneItems === task.checklist.length ? 'complete' : '';
        meta.appendChild(chip('check', `${doneItems}/${task.checklist.length}`, complete, 'Itens do checklist concluídos'));
    }

    if (task.notes) {
        meta.appendChild(chip('note', '', '', 'Possui descrição'));
    }

    // Ações
    const actions = el('div', 'task-actions');
    if (task.status !== 'todo') {
        const prev = task.status === 'done' ? 'doing' : 'todo';
        actions.appendChild(actionButton(`Mover para ${STATUS_LABELS[prev]}`, 'left', () => moveTask(task.id, prev)));
    }
    if (task.status !== 'done') {
        const next = task.status === 'todo' ? 'doing' : 'done';
        actions.appendChild(actionButton(`Mover para ${STATUS_LABELS[next]}`, 'right', () => moveTask(task.id, next)));
    }
    actions.appendChild(actionButton('Editar detalhes', 'edit', () => openDetails(task.id)));
    actions.appendChild(actionButton('Excluir tarefa', 'trash', () => deleteTask(task.id), 'btn-delete'));

    footer.append(meta, actions);
    card.appendChild(footer);

    // Arrastar e soltar
    card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(task.id));
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        Object.values(lists).forEach((l) => l.classList.remove('drag-over'));
        render();
    });

    return card;
}

function sortedTasks() {
    const mode = sortSelect.value;
    if (mode === 'manual') return tasks;
    const copy = [...tasks];
    if (mode === 'priority') {
        copy.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    } else if (mode === 'due') {
        copy.sort((a, b) => {
            if (a.due === b.due) return 0;
            if (!a.due) return 1;
            if (!b.due) return -1;
            return a.due < b.due ? -1 : 1;
        });
    }
    return copy;
}

function updateProgress() {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'done').length;
    const doing = tasks.filter((t) => t.status === 'doing').length;
    const todo = total - done - doing;
    const overdue = tasks.filter((t) => dueState(t) === 'overdue').length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    $('progressLabel').textContent = `${percent}% concluído`;
    $('progressDetail').textContent = total
        ? `${done} de ${plural(total, 'tarefa concluída', 'tarefas concluídas')}`
        : 'Nenhuma tarefa cadastrada';
    $('segDone').style.width = `${total ? (done / total) * 100 : 0}%`;
    $('segDoing').style.width = `${total ? (doing / total) * 100 : 0}%`;
    $('progressBar').setAttribute('aria-valuenow', String(percent));
    $('statDone').textContent = done;
    $('statDoing').textContent = doing;
    $('statTodo').textContent = todo;
    $('statOverdue').textContent = overdue;
}

function render() {
    Object.values(lists).forEach((list) => list.replaceChildren());

    const term = searchInput.value.trim().toLowerCase();
    const priority = filterPriority.value;
    const filtering = term !== '' || priority !== 'todas';
    const shown = { todo: 0, doing: 0, done: 0 };

    sortedTasks().forEach((task) => {
        if (term && !task.text.toLowerCase().includes(term)) return;
        if (priority !== 'todas' && task.priority !== priority) return;
        lists[task.status].appendChild(createCard(task));
        shown[task.status]++;
    });

    STATUSES.forEach((status) => {
        counts[status].textContent = shown[status];
        if (shown[status] === 0) {
            const empty = el('p', 'empty');
            empty.textContent = filtering ? 'Nenhuma tarefa encontrada com os filtros atuais.' : EMPTY_MESSAGES[status];
            lists[status].appendChild(empty);
        }
    });

    updateProgress();

    const editField = document.querySelector('.edit-input');
    if (editField) {
        editField.focus();
        editField.select();
    }
}

// ==========================================================================
// Arrastar e soltar (Drag and Drop API nativa)
// ==========================================================================
function getDragAfterElement(list, y) {
    const cards = [...list.querySelectorAll('.task-card:not(.dragging)')];
    return cards.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element || null;
}

Object.values(lists).forEach((list) => {
    list.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        list.classList.add('drag-over');
        const dragging = document.querySelector('.task-card.dragging');
        if (!dragging) return;
        const after = getDragAfterElement(list, e.clientY);
        if (after) list.insertBefore(dragging, after);
        else list.appendChild(dragging);
    });

    list.addEventListener('dragleave', (e) => {
        if (!list.contains(e.relatedTarget)) list.classList.remove('drag-over');
    });

    list.addEventListener('drop', (e) => {
        e.preventDefault();
        list.classList.remove('drag-over');
        const id = Number(e.dataTransfer.getData('text/plain'));
        const task = tasks.find((t) => t.id === id);
        if (!task) return;

        const targetStatus = list.dataset.status;
        // Com ordenação automática ativa, soltar na mesma coluna não altera nada
        if (sortSelect.value !== 'manual' && task.status === targetStatus) {
            render();
            return;
        }

        const dragging = document.querySelector('.task-card.dragging');
        const next = dragging ? dragging.nextElementSibling : null;
        const beforeId = sortSelect.value === 'manual' && next && next.classList.contains('task-card')
            ? Number(next.dataset.id)
            : null;
        moveTask(id, targetStatus, beforeId);
    });
});

// ==========================================================================
// Exportar / Importar (arquivo JSON local, sem backend)
// ==========================================================================
function exportTasks() {
    const payload = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), tasks }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kanban-tarefas-${todayStr()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Arquivo exportado com sucesso.');
}

function importTasks(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            const imported = normalizeList(Array.isArray(data) ? data : data.tasks);
            if (!imported.length) {
                showToast('O arquivo não contém tarefas válidas.');
                return;
            }
            snapshot = cloneTasks();
            tasks = imported;
            save();
            showToast(`${plural(imported.length, 'tarefa importada', 'tarefas importadas')}.`, true);
        } catch (err) {
            showToast('Arquivo inválido. Selecione um JSON exportado por este aplicativo.');
        }
    };
    reader.onerror = () => showToast('Não foi possível ler o arquivo selecionado.');
    reader.readAsText(file);
}

// ==========================================================================
// Tema e preferências
// ==========================================================================
function applyTheme(theme) {
    document.documentElement.classList.toggle('light', theme === 'light');
}

try {
    applyTheme(localStorage.getItem(THEME_KEY));
    const savedSort = localStorage.getItem(SORT_KEY);
    if (SORT_MODES.includes(savedSort)) sortSelect.value = savedSort;
} catch (err) { /* usa os valores padrão */ }

$('themeToggleBtn').addEventListener('click', () => {
    const isLight = !document.documentElement.classList.contains('light');
    applyTheme(isLight ? 'light' : 'dark');
    try { localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark'); } catch (err) { /* ignora */ }
});

// ==========================================================================
// Eventos da interface
// ==========================================================================
document.querySelectorAll('[data-icon]').forEach((node) => {
    node.innerHTML = svg(node.dataset.icon, Number(node.dataset.size) || 16);
});

$('taskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('taskInput');
    const text = input.value.trim();
    if (!text) return;
    addTask(text, $('priorityInput').value, $('dueInput').value);
    input.value = '';
    $('dueInput').value = '';
    input.focus();
});

searchInput.addEventListener('input', render);
filterPriority.addEventListener('change', render);
sortSelect.addEventListener('change', () => {
    try { localStorage.setItem(SORT_KEY, sortSelect.value); } catch (err) { /* ignora */ }
    render();
});

$('clearDoneBtn').addEventListener('click', clearDone);
$('exportBtn').addEventListener('click', exportTasks);
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importTasks(file);
    e.target.value = '';
});
$('toastUndo').addEventListener('click', undo);

// Painel de detalhes
$('detailForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveDetails();
});
$('checklistAddBtn').addEventListener('click', addChecklistItem);
$('checklistInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        addChecklistItem();
    }
});
$('dialogCancelBtn').addEventListener('click', closeDialog);
dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog(); // clique no fundo escurecido
});
dialog.addEventListener('close', () => { draft = null; });

render();
