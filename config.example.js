// ========================================
// CONFIGURATION LOCALE - EXEMPLE
// ========================================
// ⚠️ COPIEZ CE FICHIER VERS config.local.js ET REMPLISSEZ VOS VRAIES VALEURS
// ⚠️ NE COMMITEZ JAMAIS LE FICHIER config.local.js !

// Configuration du jeu de piste
const GAME_CONFIG = {
    // Centre de la zone de test (Luxembourg exemple)
    center: [49.0928, 6.1907],
    zoom: 16,
    
    // Distance en mètres pour déclencher un indice
    proximityThreshold: 50,
    
    // Clé API OpenRouteService
    // ⚠️ REMPLACEZ PAR VOTRE VRAIE CLÉ API
    // Obtenez-en une gratuitement sur: https://openrouteservice.org/dev/#/signup
    orsApiKey: 'YOUR_OPENROUTESERVICE_API_KEY_HERE',
    
    // Points d'intérêt (chargés depuis Firebase via l'admin)
    checkpoints: []
};

