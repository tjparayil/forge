// js/notes-screen.js
// Phase 3: renders the Notes screen from the IndexedDB `notes` store
// instead of the old forge_notes localStorage key. Fixes audit #8: note
// text is now escaped before going into innerHTML (the old app injected it
// raw, which broke on "<" and would be unsafe once AI-authored text renders
// here too).

import { Store } from './store.js';
import { escapeHtml } from './util.js';

const CATEGORY_LABEL = { exercise: 'Exercise', app: 'App feedback', nutrition: 'Nutrition', general: 'General' };
const CATEGORY_CLASS = { exercise: 'cat-exercise', app: 'cat-app', nutrition: 'cat-nutrition', general: 'cat-general' };

class NotesApp {
  constructor() {
    this.store = null;
    this.notes = [];
    this.activeCategory = 'exercise';
    this.activeFilter = 'all';
  }

  async init() {
    try {
      this.store = new Store();
      await this.store.open();
    } catch (err) {
      console.warn('Forge: IndexedDB unavailable, notes will not persist this session.', err);
      this.store = null;
    }
    await this.refresh();
    this._wireCompose();
  }

  async refresh() {
    this.notes = this.store ? await this.store.getAll('notes') : [];
    this.notes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  _wireCompose() {
    document.querySelectorAll('.notes-cat-btn[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.notes-cat-btn[data-cat]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeCategory = btn.dataset.cat;
      });
    });
    document.querySelectorAll('.notes-filter-btn[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.notes-filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.dataset.filter;
        this.render();
      });
    });
    document.getElementById('noteInput')?.closest('.notes-compose').querySelector('.notes-save-btn')
      .addEventListener('click', () => this.save());
    document.querySelector('#screen-notes .notes-copy-btn')?.addEventListener('click', () => this.copyAll());
  }

  async save() {
    const input = document.getElementById('noteInput');
    const text = input.value.trim();
    if (!text || !this.store) return;
    const note = { id: String(Date.now()), text, category: this.activeCategory, date: new Date().toISOString(), workout: null };
    await this.store.putAll('notes', [note]);
    this.notes.unshift(note);
    input.value = '';
    const flash = document.getElementById('savedFlash');
    flash.textContent = 'Note saved';
    flash.style.opacity = '1';
    setTimeout(() => { flash.style.opacity = '0'; }, 2000);
    this.render();
  }

  async delete(id) {
    if (!this.store) return;
    await this.store.deleteRecord('notes', id);
    this.notes = this.notes.filter(n => n.id !== id);
    this.render();
  }

  copyAll() {
    if (this.notes.length === 0) { alert('No notes to copy yet.'); return; }
    const text = this.notes.map(n => {
      const d = new Date(n.date);
      const dateStr = isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return `[${CATEGORY_LABEL[n.category] || n.category}] ${dateStr}: ${n.text}`;
    }).join('\n');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => alert('Notes copied. Paste them into your Claude conversation.'),
        () => alert(text)
      );
    } else {
      alert(text);
    }
  }

  render() {
    const list = document.getElementById('notesList');
    if (!list) return;
    const notes = this.activeFilter === 'all' ? this.notes : this.notes.filter(n => n.category === this.activeFilter);
    if (notes.length === 0) {
      list.innerHTML = `<div class="notes-empty">No notes yet${this.activeFilter !== 'all' ? ' in this category' : ''}.<br>Jot something down above — anything you want to remember or change.</div>`;
      return;
    }
    list.innerHTML = notes.map(n => {
      const d = new Date(n.date);
      const dateStr = isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const workoutTag = n.workout ? ` · ${escapeHtml(n.workout)}` : '';
      return `<div class="note-card">
        <div class="note-card-header">
          <span class="note-cat-badge ${CATEGORY_CLASS[n.category] || 'cat-general'}">${escapeHtml(CATEGORY_LABEL[n.category] || n.category)}</span>
          <span class="note-date">${escapeHtml(dateStr)}${workoutTag}</span>
          <button class="note-delete" data-delete-id="${escapeHtml(n.id)}">×</button>
        </div>
        <div class="note-text">${escapeHtml(n.text)}</div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-delete-id]').forEach(btn => {
      btn.addEventListener('click', () => this.delete(btn.dataset.deleteId));
    });
  }
}

const app = new NotesApp();
app.init().then(() => app.render());

window.ForgeNotes = { render: () => app.render() };
