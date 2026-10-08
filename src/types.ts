export interface Deck {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
}

export interface Chapter {
  id: string;
  deckId: string;
  userId: string;
  name: string;
  createdAt: number;
}

export interface Flashcard {
  id: string;
  chapterId: string;
  deckId: string;
  userId: string;
  question: string;
  answer: string;
  rating: number;
  lastReviewedAt: number | null;
  createdAt: number;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
}
