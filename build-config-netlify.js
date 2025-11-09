#!/usr/bin/env node
/**
 * Script de build pour Netlify
 * Injecte les variables d'environnement dans un fichier accessible par le navigateur
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Build Netlify: Configuration des variables d\'environnement...');

// 1. Générer firebase-config.js depuis les variables d'environnement
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

// Vérifier que toutes les variables Firebase sont définies
const missingFirebaseVars = Object.entries(firebaseConfig)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

if (missingFirebaseVars.length > 0) {
    console.error('❌ Variables Firebase manquantes:', missingFirebaseVars.join(', '));
    process.exit(1);
}

// Générer firebase-config.js
const firebaseConfigContent = `// Configuration Firebase - Générée par Netlify Build
// ⚠️ Ce fichier est généré automatiquement - NE PAS MODIFIER

export const firebaseConfig = ${JSON.stringify(firebaseConfig, null, 4)};

// Structure de la base de données Firestore
export const DB_COLLECTIONS = {
    TEAMS: 'teams',
    CHECKPOINTS: 'checkpoints', 
    GAME_SESSIONS: 'game_sessions',
    VALIDATIONS: 'validations',
    USERS: 'users',
    HELP_REQUESTS: 'help_requests',
    ADMIN_LOGS: 'admin_logs'
};

// Types d'épreuves
export const CHALLENGE_TYPES = {
    ENIGMA: 'enigma',
    VALIDATION: 'validation',
    PHOTO: 'photo',
    OBJECT: 'object',
    INFO: 'info'
};
`;

fs.writeFileSync('firebase-config.js', firebaseConfigContent);
console.log('✅ firebase-config.js généré');

// 2. Injecter la clé OpenRouteService dans un script
const orsKey = process.env.OPENROUTESERVICE_API_KEY;

if (!orsKey) {
    console.error('❌ Variable OPENROUTESERVICE_API_KEY manquante');
    process.exit(1);
}

const orsConfigContent = `// Configuration OpenRouteService - Générée par Netlify Build
// ⚠️ Ce fichier est généré automatiquement - NE PAS MODIFIER

window.ORS_API_KEY = '${orsKey}';
`;

fs.writeFileSync('ors-config.generated.js', orsConfigContent);
console.log('✅ ors-config.generated.js généré');

console.log('✅ Build Netlify terminé avec succès');
console.log('📝 Configuration:', {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    hasOrsKey: !!orsKey
});

