import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Chapter, Deck, Flashcard, Profile } from './types';

function database() {
  if (!db) throw new Error('Firebase is not configured. Complete the .env file.');
  return db;
}

function subscribe<T>(path: string, ownerId: string, callback: (rows: T[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(database(), path), where('userId', '==', ownerId)),
    (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T)),
  );
}

export const watchDecks = (uid: string, callback: (rows: Deck[]) => void) => subscribe<Deck>('decks', uid, callback);
export const watchChapters = (uid: string, callback: (rows: Chapter[]) => void) => subscribe<Chapter>('chapters', uid, callback);
export const watchCards = (uid: string, callback: (rows: Flashcard[]) => void) => subscribe<Flashcard>('flashcards', uid, callback);

export async function saveProfile(profile: Profile) {
  await setDoc(doc(database(), 'users', profile.id), profile, { merge: true });
}

export async function createDeck(userId: string, name: string) {
  return addDoc(collection(database(), 'decks'), { userId, name, createdAt: Date.now() });
}

export async function createChapter(userId: string, deckId: string, name: string) {
  return addDoc(collection(database(), 'chapters'), { userId, deckId, name, createdAt: Date.now() });
}

export async function createCard(userId: string, chapterId: string, deckId: string, question = '', answer = '') {
  return addDoc(collection(database(), 'flashcards'), {
    userId, chapterId, deckId, question, answer, rating: 0, lastReviewedAt: null, createdAt: Date.now(),
  });
}

export async function createCards(userId: string, chapterId: string, deckId: string, rows: Array<{ question: string; answer: string }>) {
  const firestore = database();
  for (let offset = 0; offset < rows.length; offset += 450) {
    const batch = writeBatch(firestore);
    rows.slice(offset, offset + 450).forEach(({ question, answer }) => {
      const target = doc(collection(firestore, 'flashcards'));
      batch.set(target, {
        userId, chapterId, deckId, question, answer, rating: 0, lastReviewedAt: null, createdAt: Date.now(),
      });
    });
    await batch.commit();
  }
}

export async function updateDeck(id: string, name: string) {
  await updateDoc(doc(database(), 'decks', id), { name });
}
export async function updateChapter(id: string, name: string) {
  await updateDoc(doc(database(), 'chapters', id), { name });
}
export async function updateCard(id: string, patch: Partial<Pick<Flashcard, 'question' | 'answer' | 'rating' | 'lastReviewedAt'>>) {
  await updateDoc(doc(database(), 'flashcards', id), patch);
}
export async function removeCard(id: string) {
  await deleteDoc(doc(database(), 'flashcards', id));
}

async function deleteByOwnerAndParent(path: string, userId: string, parentField: string, parentId: string) {
  const firestore = database();
  const snapshot = await import('firebase/firestore').then(({ getDocs }) =>
    getDocs(query(collection(firestore, path), where('userId', '==', userId), where(parentField, '==', parentId))),
  );
  for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
    const batch = writeBatch(firestore);
    snapshot.docs.slice(offset, offset + 450).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

export async function deleteChapter(userId: string, chapterId: string) {
  await deleteByOwnerAndParent('flashcards', userId, 'chapterId', chapterId);
  await deleteDoc(doc(database(), 'chapters', chapterId));
}

export async function deleteDeck(userId: string, deckId: string) {
  const firestore = database();
  const { getDocs } = await import('firebase/firestore');
  const chapters = await getDocs(query(collection(firestore, 'chapters'), where('userId', '==', userId), where('deckId', '==', deckId)));
  for (const chapter of chapters.docs) await deleteByOwnerAndParent('flashcards', userId, 'chapterId', chapter.id);
  for (let offset = 0; offset < chapters.docs.length; offset += 450) {
    const batch = writeBatch(firestore);
    chapters.docs.slice(offset, offset + 450).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  await deleteDoc(doc(firestore, 'decks', deckId));
}
