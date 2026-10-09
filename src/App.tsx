import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Papa from 'papaparse';
import {
  ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Cloud, FileUp,
  FolderPlus, GraduationCap, ImagePlus, Layers3, LogOut, MoreHorizontal, Plus, Search,
  Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import { auth, firebaseConfigured, googleProvider } from './firebase';
import {
  createCard, createCards, createChapter, createDeck, removeCard, deleteChapter,
  deleteDeck, saveProfile, updateCard, updateChapter, updateDeck, watchCards,
  watchChapters, watchDecks,
} from './data';
import type { Chapter, Deck, Flashcard } from './types';

type Screen = 'library' | 'chapter' | 'study' | 'summary';
type Draft = { question?: string; answer?: string };
const imageEditorTag = '🖼 Image';
const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;

function progressFor(cards: Flashcard[]) {
  const gradeCounts = [0, 0, 0, 0, 0];
  let unseen = 0;
  for (const card of cards) {
    if (card.lastReviewedAt == null) unseen += 1;
    else gradeCounts[Math.max(0, Math.min(4, card.rating))] += 1;
  }
  const percentage = cards.length
    ? Math.round(cards.reduce((sum, card) => sum + Math.max(0, Math.min(4, card.rating)), 0) / (cards.length * 4) * 100)
    : 0;
  return { percentage, gradeCounts, unseen };
}

function SegmentedProgress({ cards, className = '' }: { cards: Flashcard[]; className?: string }) {
  const { percentage, gradeCounts, unseen } = progressFor(cards);
  const total = cards.length;
  return <div className={`segmented-progress ${className}`} role="img" aria-label={`${percentage}% progress`}>
    {gradeCounts.map((count, grade) => count > 0 && <span key={grade} className={`progress-segment grade-${grade + 1}`} style={{ width: `${count / total * 100}%` }} title={`Grade ${grade + 1}: ${count}`} />)}
    {unseen > 0 && <span className="progress-segment grade-unseen" style={{ width: `${unseen / total * 100}%` }} title={`Not seen yet: ${unseen}`} />}
  </div>;
}

function imageMarkdownToEditor(markdown: string) {
  return markdown.replace(/!\[image\]\((https?:\/\/[^)\s]+)\)/gi, imageEditorTag);
}

function imageEditorToMarkdown(value: string, currentMarkdown: string) {
  const imageMarkdown = [...currentMarkdown.matchAll(/!\[image\]\((https?:\/\/[^)\s]+)\)/gi)].map(([match]) => match);
  let imageIndex = 0;
  return value.replaceAll(imageEditorTag, () => imageMarkdown[imageIndex++] ?? imageEditorTag);
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [activeDeckId, setActiveDeckId] = useState('');
  const [activeChapterId, setActiveChapterId] = useState('');
  const [screen, setScreen] = useState<Screen>('library');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [preview, setPreview] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [selectedStudyChapters, setSelectedStudyChapters] = useState<string[]>([]);
  const [studyQueue, setStudyQueue] = useState<string[]>([]);
  const [studyIndex, setStudyIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [menu, setMenu] = useState<{ kind: 'deck' | 'chapter'; id: string } | null>(null);
  const [uploadingId, setUploadingId] = useState('');
  const [pendingFocusCardId, setPendingFocusCardId] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const questionInputs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (signedInUser) => {
      setUser(signedInUser);
      if (signedInUser) {
        try {
          await saveProfile({ id: signedInUser.uid, email: signedInUser.email ?? '', name: signedInUser.displayName ?? '' });
        } catch (error) { setToast(friendlyError(error)); }
      } else {
        setDecks([]); setChapters([]); setCards([]);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubscribers = [
      watchDecks(user.uid, setDecks),
      watchChapters(user.uid, setChapters),
      watchCards(user.uid, setCards),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [user]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 3800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const markOnline = () => setIsOnline(true);
    const markOffline = () => setIsOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  useEffect(() => {
    if (decks.length && !decks.some((deck) => deck.id === activeDeckId)) setActiveDeckId(decks[0].id);
    if (!decks.length) { setActiveDeckId(''); setActiveChapterId(''); }
  }, [decks, activeDeckId]);

  useEffect(() => {
    if (activeChapterId && !chapters.some((chapter) => chapter.id === activeChapterId && chapter.deckId === activeDeckId)) setActiveChapterId('');
  }, [activeDeckId, activeChapterId, chapters]);

  const activeDeck = decks.find((deck) => deck.id === activeDeckId);
  const deckChapters = useMemo(() => chapters.filter((chapter) => chapter.deckId === activeDeckId), [chapters, activeDeckId]);
  const activeChapter = chapters.find((chapter) => chapter.id === activeChapterId);
  const chapterCards = useMemo(() => cards.filter((card) => card.chapterId === activeChapterId).sort((a, b) => a.createdAt - b.createdAt), [cards, activeChapterId]);
  const filteredDecks = decks.filter((deck) => deck.name.toLowerCase().includes(search.toLowerCase()));
  const currentStudyCard = cards.find((card) => card.id === studyQueue[studyIndex]);
  const studyChapters = chapters.filter((chapter) => selectedStudyChapters.includes(chapter.id));
  const studyCards = cards.filter((card) => selectedStudyChapters.includes(card.chapterId));
  const studyProgress = progressFor(studyCards).percentage;
  const offline = !isOnline;

  useEffect(() => {
    if (!pendingFocusCardId || !chapterCards.some((card) => card.id === pendingFocusCardId)) return;
    questionInputs.current[pendingFocusCardId]?.focus();
    setPendingFocusCardId('');
  }, [chapterCards, pendingFocusCardId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try { await action(); }
    catch (error) { setToast(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function addNewDeck() {
    const name = window.prompt('New deck name');
    if (!name?.trim() || !user) return;
    await run(async () => {
      const ref = await createDeck(user.uid, name.trim());
      setActiveDeckId(ref.id);
      setToast('Deck created');
    });
  }

  async function addNewChapter() {
    if (!user || !activeDeck) return;
    const name = window.prompt('New chapter name');
    if (!name?.trim()) return;
    await run(async () => {
      const ref = await createChapter(user.uid, activeDeck.id, name.trim());
      setActiveChapterId(ref.id); setScreen('chapter'); setToast('Chapter created');
    });
  }

  async function renameItem(kind: 'deck' | 'chapter', id: string) {
    const item = kind === 'deck' ? decks.find((row) => row.id === id) : chapters.find((row) => row.id === id);
    if (!item) return;
    const name = window.prompt('New name', item.name);
    if (!name?.trim()) return;
    await run(async () => {
      if (kind === 'deck') await updateDeck(id, name.trim()); else await updateChapter(id, name.trim());
      setMenu(null);
    });
  }

  async function removeItem(kind: 'deck' | 'chapter', id: string) {
    const item = kind === 'deck' ? decks.find((row) => row.id === id) : chapters.find((row) => row.id === id);
    if (!item || !user || !window.confirm(`Delete “${item.name}” and all its contents? This action cannot be undone.`)) return;
    await run(async () => {
      if (kind === 'deck') { await deleteDeck(user.uid, id); setScreen('library'); }
      else { await deleteChapter(user.uid, id); setScreen('library'); }
      setMenu(null); setToast('Content deleted');
    });
  }

  async function addCard(focusQuestion = false) {
    if (!user || !activeChapter) return;
    await run(async () => {
      const ref = await createCard(user.uid, activeChapter.id, activeChapter.deckId);
      setDrafts((previous) => ({ ...previous, [ref.id]: { question: '', answer: '' } }));
      if (focusQuestion) setPendingFocusCardId(ref.id);
    });
  }

  async function saveField(card: Flashcard, field: 'question' | 'answer', value: string) {
    const updatedValue = field === 'answer'
      ? imageEditorToMarkdown(value, drafts[card.id]?.answer ?? card.answer)
      : value;
    if (updatedValue === card[field]) return;
    await run(() => updateCard(card.id, { [field]: updatedValue }));
  }

  async function importCsv(file?: File) {
    if (!file || !user || !activeChapter) return;
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: async (result) => {
        const rows = result.data
          .filter((row) => row.length >= 2 && (row[0]?.trim() || row[1]?.trim()))
          .map((row) => ({ question: row[0]?.trim() ?? '', answer: row[1]?.trim() ?? '' }));
        if (!rows.length) { setToast('No question/answer pairs found in the CSV'); return; }
        await run(async () => {
          await createCards(user.uid, activeChapter.id, activeChapter.deckId, rows);
          setToast(`${rows.length} ${rows.length === 1 ? 'flashcard imported' : 'flashcards imported'}`);
        });
      },
      error: (error: Error) => setToast(`Invalid CSV: ${error.message}`),
    });
    if (csvInput.current) csvInput.current.value = '';
  }

  async function uploadImage(file?: File, targetCardId = uploadingId) {
    const cardId = targetCardId;
    if (!file || !cardId) return;
    if (!cloudName || !uploadPreset) { setToast('Configure Cloudinary in .env to upload images'); return; }
    await run(async () => {
      const form = new FormData();
      form.append('file', file); form.append('upload_preset', uploadPreset);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: form });
      if (!response.ok) throw new Error('Cloudinary upload failed');
      const result = await response.json() as { secure_url: string };
      const card = cards.find((item) => item.id === cardId);
      if (!card) return;
      const current = drafts[cardId]?.answer ?? card.answer;
      const markdown = `![image](${result.secure_url})`;
      const answer = `${current}${current.trim() ? '\n\n' : ''}${markdown}`;
      setDrafts((previous) => ({ ...previous, [cardId]: { ...previous[cardId], answer } }));
      await updateCard(cardId, { answer });
      setToast('Image uploaded and added to the answer');
    });
    setUploadingId('');
    if (fileInput.current) fileInput.current.value = '';
  }

  function startStudy(chapterIds: string[]) {
    const selected = cards.filter((card) => chapterIds.includes(card.chapterId));
    if (!selected.length) { setToast('Add at least one flashcard before starting'); return; }
    const shuffled = selected
      .map((card) => ({ card, tieBreak: Math.random() }))
      .sort((a, b) => a.card.rating - b.card.rating || a.tieBreak - b.tieBreak)
      .map(({ card }) => card);
    const batch = shuffled.length >= 10 ? shuffled.slice(0, 10) : Array.from({ length: 10 }, (_, index) => shuffled[index % shuffled.length]);
    setSelectedStudyChapters(chapterIds); setStudyQueue(batch.map((card) => card.id));
    setStudyIndex(0); setRevealed(false); setScreen('study');
  }

  async function rateAndContinue(rating: number) {
    if (!currentStudyCard) return;
    const card = currentStudyCard;
    await run(async () => {
      const points = rating - 1;
      const lastReviewedAt = Date.now();
      await updateCard(card.id, { rating: points, lastReviewedAt });
      setCards((previous) => previous.map((item) => item.id === card.id ? { ...item, rating: points, lastReviewedAt } : item));
      if (studyIndex + 1 >= studyQueue.length) setScreen('summary');
      else { setStudyIndex((index) => index + 1); setRevealed(false); }
    });
  }

  function toggleChapterForStudy(id: string) {
    setSelectedStudyChapters((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  if (!firebaseConfigured) return <ConfigurationScreen />;
  if (!user) return <LoginScreen onLogin={() => auth && signInWithPopup(auth, googleProvider).catch((error: unknown) => setToast(friendlyError(error)))} toast={toast} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Layers3 size={20} /></div><span>PerfectFlashcards</span></div>
        <button className={`nav-item ${screen === 'library' || screen === 'chapter' ? 'active' : ''}`} onClick={() => setScreen('library')}><BookOpen size={18} /> My library</button>
        <div className="sidebar-section"><span>YOUR DECKS</span><button className="icon-button quiet" title="Create deck" onClick={addNewDeck}><Plus size={17} /></button></div>
        <div className="deck-list">
          {decks.map((deck) => <div key={deck.id} className={`deck-row ${activeDeckId === deck.id ? 'selected' : ''}`}>
            <button className="deck-link" onClick={() => { setActiveDeckId(deck.id); setScreen('library'); }}><span className="deck-dot" />{deck.name}</button>
            <button className="icon-button deck-menu" title="Options deck" onClick={() => setMenu(menu?.id === deck.id ? null : { kind: 'deck', id: deck.id })}><MoreHorizontal size={17} /></button>
            {menu?.kind === 'deck' && menu.id === deck.id && <div className="context-menu"><button onClick={() => renameItem('deck', deck.id)}>Rename</button><button className="danger-text" onClick={() => removeItem('deck', deck.id)}>Delete deck</button></div>}
          </div>)}
          {!decks.length && <p className="sidebar-empty">No decks yet</p>}
        </div>
        <div className="sidebar-bottom"><div className="user-chip"><img src={user.photoURL ?? ''} alt="" /><span>{user.displayName ?? user.email}</span><button title="Sign out" className="icon-button quiet" onClick={() => auth && signOut(auth)}><LogOut size={16} /></button></div><div className="sync-state"><span className={offline ? 'status-dot offline' : 'status-dot'} />{offline ? 'Offline · changes saved' : 'Sync is up to date'}</div></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb"><span>Personal space</span>{activeDeck && <><ChevronRight size={14} /><span>{activeDeck.name}</span></>}{activeChapter && <><ChevronRight size={14} /><strong>{activeChapter.name}</strong></>}</div><div className="top-actions"><div className="search-box"><Search size={16} /><input placeholder="Search decks…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><button className="avatar-button" title={user.displayName ?? 'Profile'}><img src={user.photoURL ?? ''} alt="" /></button></div></header>

        {screen === 'library' && <section className="page-content">
          <div className="welcome-row"><div><div className="eyebrow"><Sparkles size={14} /> YOUR LEARNING SPACE</div><h1>Learn, one card<br className="mobile-break" /> at a time.</h1><p className="lead">The best ideas are worth remembering.</p></div><div className="welcome-art"><div className="art-card back-card" /><div className="art-card front-card"><span>Curiosity</span><strong>Knowledge<br />is built<br />one step at a time.</strong>
            <div className="art-spark">✳</div></div><div className="art-orbit" /></div></div>
          <div className="section-heading"><div><h2>Your library</h2><p>{decks.length} {decks.length === 1 ? 'deck' : 'decks'} · {cards.length} flashcard</p></div><button className="button primary" onClick={addNewDeck}><Plus size={17} /> New deck</button></div>
          {filteredDecks.length ? <div className="deck-grid">{filteredDecks.map((deck, index) => {
            const deckChapterRows = chapters.filter((chapter) => chapter.deckId === deck.id);
            const deckCards = cards.filter((card) => card.deckId === deck.id);
            const completion = progressFor(deckCards).percentage;
            return <article key={deck.id} className={`deck-card tone-${index % 4}`} role="button" tabIndex={0} aria-label={`Open ${deck.name} deck`}
              onClick={(event) => { if ((event.target as HTMLElement).closest('button')) return; setActiveDeckId(deck.id); setActiveChapterId(''); setScreen('chapter'); }}
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setActiveDeckId(deck.id); setActiveChapterId(''); setScreen('chapter'); } }}>
              <div className="deck-card-top"><div className="deck-icon"><Layers3 size={20} /></div><button className="icon-button" title="Options" onClick={(event) => { event.stopPropagation(); setMenu(menu?.id === deck.id ? null : { kind: 'deck', id: deck.id }); }}><MoreHorizontal size={19} /></button>
                {menu?.kind === 'deck' && menu.id === deck.id && <div className="context-menu card-menu"><button onClick={() => renameItem('deck', deck.id)}>Rename</button><button className="danger-text" onClick={() => removeItem('deck', deck.id)}>Delete deck</button></div>}
              </div>
              <h3 className="deck-card-title">{deck.name}</h3>
              <p>{deckChapterRows.length} chapters · {deckCards.length} cards</p><div className="deck-progress-row"><SegmentedProgress cards={deckCards} className="deck-progress-bar" /><strong className="deck-progress-percent">{completion}%</strong></div><div className="deck-card-footer"><span>progress</span><button className="text-button" onClick={(event) => { event.stopPropagation(); setActiveDeckId(deck.id); setSelectedStudyChapters(deckChapterRows.map((chapter) => chapter.id)); startStudy(deckChapterRows.map((chapter) => chapter.id)); }}>Study <ChevronRight size={14} /></button></div>
            </article>;
          })}<button className="new-deck-card" onClick={addNewDeck}><span><Plus size={20} /></span><strong>Create a deck</strong><small>Organize a new subject</small></button></div> : <div className="empty-state"><div className="empty-illustration"><BookOpen size={30} /></div><h3>{search ? 'No decks found' : 'Start with a new idea'}</h3><p>{search ? 'Try a different search term.' : 'Create your first deck and collect your flashcards here.'}</p>
            {!search && <button className="button primary" onClick={addNewDeck}><Plus size={16} /> Create your first deck</button>}</div>}
          <div className="offline-note"><Cloud size={17} /><span><strong>Ready offline.</strong> Your changes sync automatically when you reconnect.</span><ChevronRight size={16} /></div>
        </section>}

        {screen === 'chapter' && <section className="page-content chapter-page">
          <div className="chapter-heading"><button className="back-link" onClick={() => setScreen('library')}><ArrowLeft size={16} /> All decks</button><div className="chapter-title-row"><div><div className="eyebrow">{activeDeck?.name ?? 'YOUR DECK'}</div><h1>{activeDeck?.name ?? 'Deck'}</h1><p className="lead">Choose a chapter or create one to organize your cards.</p></div><button className="button primary" onClick={addNewChapter}><Plus size={17} /> New chapter</button></div></div>
          <div className="chapter-layout">
            <aside className="chapter-nav">
              <div className="subsection-label">CHAPTERS <span>{deckChapters.length}</span></div>
              {deckChapters.map((chapter) => {
                const chapterProgressCards = cards.filter((card) => card.chapterId === chapter.id);
                const chapterCompletion = progressFor(chapterProgressCards).percentage;
                return <div key={chapter.id} className="chapter-list-item">
                <div className={`chapter-nav-row ${chapter.id === activeChapterId ? 'current' : ''}`}>
                <button onClick={() => { setActiveChapterId(chapter.id); setScreen('chapter'); }}><BookOpen size={16} /><span>{chapter.name}</span><small>{chapterProgressCards.length}</small></button>
                <input aria-label={`Select ${chapter.name} for study`} className="chapter-study-check" type="checkbox" checked={selectedStudyChapters.includes(chapter.id)} onChange={() => toggleChapterForStudy(chapter.id)} />
                <button className="icon-button" title="Chapter options" onClick={() => setMenu(menu?.id === chapter.id ? null : { kind: 'chapter', id: chapter.id })}><MoreHorizontal size={16} /></button>
                {menu?.kind === 'chapter' && menu.id === chapter.id && <div className="context-menu"><button onClick={() => renameItem('chapter', chapter.id)}>Rename</button><button className="danger-text" onClick={() => removeItem('chapter', chapter.id)}>Delete</button></div>}
                </div>
                {chapterProgressCards.length > 0 && <div className="chapter-progress-row"><SegmentedProgress cards={chapterProgressCards} className="chapter-progress-bar" /><strong>{chapterCompletion}%</strong></div>}
              </div>;
              })}
              {!deckChapters.length && <p className="subtle">No chapters yet.</p>}
              <button className="study-selection" disabled={!selectedStudyChapters.some((id) => deckChapters.some((chapter) => chapter.id === id))} onClick={() => startStudy(selectedStudyChapters.filter((id) => deckChapters.some((chapter) => chapter.id === id)))}><GraduationCap size={15} /> Study selection</button>
            </aside>
            <div className="chapter-workspace">
              {activeChapter ? <>
                <div className="workspace-header"><div><h2>{activeChapter.name}</h2><span>{chapterCards.length} flashcards</span></div><div className="workspace-actions"><input ref={csvInput} hidden type="file" accept=".csv,text/csv" onChange={(event) => importCsv(event.target.files?.[0])} /><button className="button secondary deck-study-button" onClick={() => startStudy(deckChapters.map((chapter) => chapter.id))}><GraduationCap size={16} /> Study deck</button><button className="button secondary" onClick={() => csvInput.current?.click()}><FileUp size={16} /> Import CSV</button><button className="button primary" onClick={() => addCard()}><Plus size={17} /> New card</button></div></div>
                <div className="column-labels"><span>QUESTION</span><span>ANSWER <small>MARKDOWN</small></span></div>
                <div className="cards-list">
                  {chapterCards.map((card, index) => <article key={card.id} className="editor-card">
                    <div className="card-number">{String(index + 1).padStart(2, '0')}</div>
                    <div className="editor-column"><textarea ref={(element) => { questionInputs.current[card.id] = element; }} aria-label={`Question ${index + 1}`} placeholder="Write a question…" value={drafts[card.id]?.question ?? card.question} onChange={(event) => setDrafts((previous) => ({ ...previous, [card.id]: { ...previous[card.id], question: event.target.value } }))} onBlur={(event) => saveField(card, 'question', event.target.value)} /></div>
                    <div className="editor-column answer-column">
                      {preview[card.id] ? <div className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{drafts[card.id]?.answer ?? card.answer}</ReactMarkdown></div> : <textarea aria-label={`Answer ${index + 1}`} placeholder="Write an answer… Markdown supported" value={imageMarkdownToEditor(drafts[card.id]?.answer ?? card.answer)} onChange={(event) => setDrafts((previous) => ({ ...previous, [card.id]: { ...previous[card.id], answer: imageEditorToMarkdown(event.target.value, previous[card.id]?.answer ?? card.answer) } }))} onBlur={(event) => saveField(card, 'answer', event.target.value)} onKeyDown={(event) => { if (event.key === 'Tab' && !event.shiftKey && index === chapterCards.length - 1) { event.preventDefault(); void addCard(true); } }} onPaste={(event) => { const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/')); const imageFile = imageItem?.getAsFile(); if (imageFile) { event.preventDefault(); void uploadImage(imageFile, card.id); } }} />}
                      <div className="editor-tools"><button title="Upload an image" onClick={() => { setUploadingId(card.id); fileInput.current?.click(); }}><ImagePlus size={15} /> Image</button><button onClick={() => setPreview((previous) => ({ ...previous, [card.id]: !previous[card.id] }))}>{preview[card.id] ? 'Edit' : 'Preview'}</button><button className="delete-card" title="Delete flashcard" onClick={() => window.confirm('Delete this flashcard?') && run(() => removeCard(card.id))}><Trash2 size={15} /></button></div>
                    </div>
                  </article>)}
                </div>
                {!chapterCards.length && <div className="empty-state compact"><div className="empty-illustration"><CircleHelp size={27} /></div><h3>This chapter is ready</h3><p>Add a card or import a CSV with questions and answers.</p><div className="empty-actions"><button className="button primary" onClick={() => addCard()}><Plus size={16} /> Add card</button><button className="button secondary" onClick={() => csvInput.current?.click()}><Upload size={16} /> Import CSV</button></div></div>}
                <input ref={fileInput} hidden type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0])} />
              </> : <div className="empty-state compact"><div className="empty-illustration"><FolderPlus size={28} /></div><h3>Choose a chapter</h3><p>Open a chapter from the list or create a new one.</p><button className="button primary" onClick={addNewChapter}><Plus size={16} /> Create chapter</button></div>}
            </div>
          </div>
        </section>}

        {screen === 'study' && <section className="study-page"><div className="study-top"><button className="back-link" onClick={() => setScreen('library')}><ArrowLeft size={16} /> Exit study</button><span className="study-batch">STUDY BATCH
          <span>{studyIndex + 1} / {studyQueue.length}</span></span></div>
          <div className="study-progress"><span style={{ width: `${(studyIndex / Math.max(studyQueue.length, 1)) * 100}%` }} /></div>
          {currentStudyCard ? <div className="study-center"><div className="study-kicker"><GraduationCap size={16} /> {chapters.find((chapter) => chapter.id === currentStudyCard.chapterId)?.name ?? 'FLASHCARD'}</div><div className="study-card"><div className="study-card-label">{revealed ? 'ANSWER' : 'QUESTION'}</div><div className="study-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{revealed ? currentStudyCard.answer : currentStudyCard.question}</ReactMarkdown></div>{!revealed ? <button className="button primary reveal-button" onClick={() => setRevealed(true)}>Show answer <ChevronDown size={16} /></button> : <div className="rating-area"><span>How well did you know it?</span><div className="rating-buttons">{[1, 2, 3, 4, 5].map((rating) => <button key={rating} aria-label={`Grade ${rating}`} className={`rating-button rating-${rating}`} onClick={() => rateAndContinue(rating)} disabled={busy}><span>{rating}</span></button>)}</div></div>}</div><div className="study-hint"><span>Space</span> to reveal the answer <span>·</span> Be honest with yourself</div></div> : <div className="empty-state"><h3>No cards to study</h3>
            <button className="button primary" onClick={() => setScreen('library')}>Back to library</button></div>}
        </section>}

        {screen === 'summary' && <section className="summary-page"><div className="summary-card"><div className="summary-icon"><Check size={27} /></div><div className="eyebrow">SESSION COMPLETE</div><h1>One step forward.</h1><p className="lead">You've completed your study batch.</p>
          <div className="summary-stat"><strong>{studyProgress}%</strong><span>overall progress<br />across selected content</span></div>
          <SegmentedProgress cards={studyCards} className="summary-meter" />
          <div className="summary-meta"><span>{studyCards.length} cards in your selection</span>
            <span>{studyChapters.length} {studyChapters.length === 1 ? 'chapter' : 'chapters'}</span></div>
          <div className="summary-actions"><button className="button secondary" onClick={() => setScreen('library')}>Back to library</button>
            <button className="button primary" onClick={() => startStudy(selectedStudyChapters)}><GraduationCap size={16} /> Another batch</button></div></div></section>}
      </main>

      {screen !== 'study' && screen !== 'summary' && <button className="floating-study" onClick={() => startStudy(deckChapters.map((chapter) => chapter.id))}><GraduationCap size={17} /> Study <ChevronRight size={16} /></button>}
      {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast('')} aria-label="Close"><X size={15} /></button></div>}
      {busy && <div className="saving-indicator"><span /> Saving…</div>}
    </div>
  );
}

function LoginScreen({ onLogin, toast }: { onLogin: () => void; toast: string }) {
  return <main className="login-screen"><div className="login-panel"><div className="brand login-brand"><div className="brand-mark"><Layers3 size={20} /></div><span>PerfectFlashcards</span></div><div className="login-copy"><div className="eyebrow"><Sparkles size={14} /> ONE CARD AT A TIME</div><h1>Make room<br />for what you learn.</h1><p>Your ideas, organized as flashcards. Ready to go wherever you are, even offline.</p></div><button className="google-button" onClick={onLogin}><GoogleMark /> Continue with Google</button><div className="login-privacy"><Cloud size={15} /> Your progress syncs securely.</div>{toast && <div className="toast login-toast">{toast}</div>}</div><div className="login-visual"><div className="login-note note-one"><small>DAILY REVIEW</small><strong>Every small<br />step counts.</strong><span>● ● ● ○ ○</span></div><div className="login-note note-two"><div className="mini-mark">✳</div><small>SCIENCE</small><strong>What is<br />neuroplasticity?</strong><div className="note-footer">The brain's ability to adapt</div></div><div className="visual-sun" /><div className="visual-caption">Make what matters<br />memorable.</div></div></main>;
}

function ConfigurationScreen() {
  return <main className="config-screen"><div className="config-card"><div className="brand"><div className="brand-mark"><Layers3 size={20} /></div><span>PerfectFlashcards</span></div><h1>Connect your workspace.</h1><p>To get started, configure your Firebase credentials in the <strong>.env</strong> file. See the project README for full instructions.</p>
    <div className="config-step"><span>1</span><div><strong>Create the configuration file</strong><small>Copy .env.example to .env and enter your Firebase app settings.</small></div></div>
    <div className="config-step"><span>2</span><div><strong>Enable Google Sign-In</strong><small>Enable the Google provider in the Firebase Authentication console.</small></div></div></div></main>;
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" width="19" height="19"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 5)"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.73 7.18l7.63 5.92c4.45-4.1 7.14-10.15 7.14-17.57Z" transform="translate(0 0) scale(.92)"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z" transform="translate(1 0)"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.78l-7.63-5.92c-2.12 1.42-4.84 2.26-8.27 2.26-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 0) scale(.92)"/></svg>;
}

export default App;
