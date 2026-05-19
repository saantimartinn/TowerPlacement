// src/firebase.js

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDZir9gcgwb4zZVYTsZFhYcT4McUpoUrvg",
  authDomain: "webinar1-7f011.firebaseapp.com",
  projectId: "webinar1-7f011",
  storageBucket: "webinar1-7f011.firebasestorage.app",
  messagingSenderId: "845256547199",
  appId: "1:845256547199:web:af139ddbecf31ebdcdd84a"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);