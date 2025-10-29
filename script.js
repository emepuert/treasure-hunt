// Import de la configuration des variables d'environnement
import { ENV_CONFIG } from './env-config.js';

// Configuration du jeu de piste - Version 18:58 - Fix bouton fermeture modal énigme
const GAME_CONFIG = {
    // Centre de la zone de test
    center: [49.0928, 6.1907],
    zoom: 16,
    // Distance en mètres pour déclencher un indice
    proximityThreshold: 50,
    // Clé API OpenRouteService
    orsApiKey: ENV_CONFIG.orsApiKey,
    // Points d'intérêt avec coordonnées et indices
    checkpoints: [] // Maintenant chargés depuis Firebase via l'admin
};

// Variables globales
let map;
let userMarker;
let userPosition = null;
let foundCheckpoints = [];
let checkpointMarkers = [];
let unlockedCheckpoints = [0]; // Le lobby est toujours accessible
let currentRoute = null; // Route actuelle affichée
let routeControl = null; // Contrôle de navigation
let currentTeam = null; // Équipe connectée
let currentTeamId = null; // ID unique de l'équipe dans Firebase
let currentDestination = null; // Destination actuelle pour recalcul auto
let lastRecalculateTime = 0; // Timestamp du dernier recalcul pour éviter les spams
let firebaseService = null; // Service Firebase
let isMapInitialized = false; // Vérifier si la carte est déjà initialisée
let isGameStarted = false; // Vérifier si le jeu est déjà démarré
let hasEverGotPosition = false; // Track si on a déjà réussi à obtenir une position
let geolocationErrorCount = 0; // Compter les erreurs consécutives

// ===== SYSTÈME DE MONITORING FIREBASE =====
let firebaseListenerActive = false; // Track si le listener Firebase est actif
let lastFirebaseUpdate = 0; // Timestamp de la dernière mise à jour Firebase
let firebaseListenerUnsubscribe = null; // Fonction pour désabonner le listener
let fallbackPollingInterval = null; // Intervalle de polling de secours
let validationsListenerUnsubscribe = null; // Fonction pour désabonner le listener de validations
let helpRequestsListenerUnsubscribe = null; // Fonction pour désabonner le listener de demandes d'aide
let notificationListenersConfigured = false; // Track si les listeners de notifications sont configurés

// ===== PROTECTION ANTI-SPAM MODALS =====
let lastCheckpointTrigger = {}; // Timestamp par checkpoint
let activeModals = new Set(); // Modals actuellement ouverts
let dismissedModals = new Set(); // Modals fermés manuellement par l'utilisateur (ne pas réouvrir automatiquement)
let modalCooldown = 2000; // 2 secondes minimum entre déclenchements
let pendingPhotoValidations = new Set(); // Checkpoints photos en attente de validation
let checkpointsInRange = new Set(); // Checkpoints actuellement dans la zone de proximité (mis à jour toutes les 3s)
let discoveredCheckpoints = new Set(); // Checkpoints dont la notification de découverte a déjà été affichée

// ===== CONSOLE LOGGER MOBILE =====
let mobileConsoleLogger = null;
let consoleHistory = [];
let maxConsoleHistory = 500;
let consoleFilterEnabled = true; // Filtrage activé par défaut

// ===== FIREBASE LOGGING =====
let isFirebaseLoggingActive = false; // Si le logging vers Firebase est actif
let firebaseLoggingSessionId = null; // ID unique de la session de logging
let firebaseLoggingInterval = null; // Intervalle d'envoi des logs
const FIREBASE_LOG_INTERVAL = 10000; // Envoyer les logs toutes les 10 secondes

// Variables pour l'épreuve audio
let currentAudioCheckpoint = null;
let audioContext = null;
let audioStream = null;
let audioAnalyser = null;
let audioDataArray = null;
let audioProgress = 0;
let audioStartTime = null;
let isAudioChallengeActive = false;
let audioAnimationId = null;

// Variables pour le QCM
let currentQCMCheckpoint = null;
let selectedAnswers = [];

// Variables pour l'énigme
let currentRiddleCheckpoint = null;

// ===== SYSTÈME DE MONITORING =====
let errorLog = [];
let performanceMetrics = {
    startTime: Date.now(),
    errors: 0,
    apiCalls: 0,
    geolocationAttempts: 0
};

// ===== SYSTÈME DE VERROUILLAGE GPS =====
let gpsLockState = {
    isLocked: false,                    // Si le GPS est actuellement verrouillé
    lastPosition: null,                 // Dernière position valide
    lastPositionTime: null,             // Timestamp de la dernière position
    consecutiveBadReadings: 0,          // Nombre de lectures GPS suspectes consécutives
    stableReadings: 0,                  // Nombre de lectures stables consécutives
    lockReason: null                    // Raison du verrouillage
};

// Seuils de sécurité GPS
const GPS_SAFETY_THRESHOLDS = {
    maxAccuracy: 80,                    // Précision max acceptable (mètres)
    maxSpeed: 150,                      // Vitesse max acceptable (km/h)
    maxJumpDistance: 200,               // Distance max acceptable entre 2 positions (mètres)
    minTimeBetweenJumps: 3000,          // Temps min entre 2 positions pour calculer la vitesse (ms)
    badReadingsToLock: 2,               // Nombre de lectures mauvaises avant verrouillage
    stableReadingsToUnlock: 3           // Nombre de lectures stables avant déverrouillage
};

// ===== SYSTÈME D'AUTO-SAVE INTELLIGENT =====
let autoSaveInterval = null;            // Intervalle d'auto-save
let lastSavedState = null;              // Dernier état sauvegardé (pour throttling)
let lastSaveTime = 0;                   // Timestamp de la dernière sauvegarde
let saveHistory = [];                   // Historique des sauvegardes (pour debug)
let saveMetrics = {
    totalSaves: 0,                      // Nombre total de sauvegardes
    skippedSaves: 0,                    // Nombre de sauvegardes ignorées (throttling)
    failedSaves: 0,                     // Nombre de sauvegardes échouées
    lastError: null                     // Dernière erreur
};
const AUTO_SAVE_INTERVAL = 10000;       // Sauvegarder toutes les 10 secondes
const MAX_SAVE_HISTORY = 50;            // Garder les 50 dernières sauvegardes
let isAutoSaveActive = false;           // Track si l'auto-save est actif
let gpsWatchId = null;                  // ID du GPS watch pour pause/resume

// ===== CONSOLE LOGGER MOBILE =====

// Intercepter les logs console
function initializeMobileConsoleLogger() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;
    
    function addToHistory(type, args) {
        const timestamp = new Date().toLocaleTimeString();
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        
        // 🔥 FILTRE : Ne garder que les logs importants (si activé)
        if (consoleFilterEnabled) {
            const shouldKeep = 
                type === 'error' || 
                type === 'warn' || 
                type === 'admin' ||  // ✅ Toujours garder les logs admin
                (type === 'log' && (
                    message.includes('❌') || 
                    message.includes('⚠️') || 
                    message.includes('🚫') || 
                    message.includes('✅✅✅') ||  // ✅ Logs de version du script
                    message.includes('✅ [Checkpoint Validation Log]') ||
                    message.includes('✅ Photo approuvée') ||  // ✅ Validation photo
                    message.includes('✅ Checkpoint') && message.includes('ajouté') ||
                    message.includes('🎉') ||
                    message.includes('📸 Modal photo ouvert') ||
                    message.includes('🎤 Modal audio ouvert') ||
                    message.includes('📋 Modal QCM ouvert') ||
                    message.includes('🏥 Health Check') ||
                    message.includes('💾 Progression sauvegardée') ||
                    message.includes('🔓 Checkpoint suivant débloqué') ||
                    message.includes('🔧') ||  // ✅ Logs de debug/config
                    message.includes('🔔') ||  // ✅ Logs de setup listeners
                    message.includes('🔵') ||  // ✅ Logs de debug detaillés
                    message.includes('🆕') ||  // ✅ Logs de traitement nouveau
                    message.includes('🔄') ||  // ✅ Logs de retraitement
                    message.includes('ℹ️') ||  // ✅ Logs info
                    message.includes('🗺️') ||  // ✅ Logs de mise à jour carte
                    message.includes('🎯 Checkpoint') && message.includes('trouvé')
                ));
            
            if (!shouldKeep) return; // Ignorer ce log
        }
        
        consoleHistory.push({
            timestamp,
            type,
            message,
            full: `[${timestamp}] ${type.toUpperCase()}: ${message}`
        });
        
        // Limiter l'historique
        if (consoleHistory.length > maxConsoleHistory) {
            consoleHistory.shift();
        }
        
        // Mettre à jour le logger mobile s'il est ouvert
        if (mobileConsoleLogger && mobileConsoleLogger.style.display !== 'none') {
            updateMobileConsoleDisplay();
        }
    }
    
    console.log = function(...args) {
        addToHistory('log', args);
        originalLog.apply(console, args);
    };
    
    console.error = function(...args) {
        addToHistory('error', args);
        originalError.apply(console, args);
    };
    
    console.warn = function(...args) {
        addToHistory('warn', args);
        originalWarn.apply(console, args);
    };
    
    console.info = function(...args) {
        addToHistory('info', args);
        originalInfo.apply(console, args);
    };
}

// Créer le logger mobile
function createMobileConsoleLogger() {
    if (mobileConsoleLogger) return;
    
    mobileConsoleLogger = document.createElement('div');
    mobileConsoleLogger.id = 'mobile-console-logger';
    mobileConsoleLogger.innerHTML = `
        <div class="console-header">
            <span>📱 Console Mobile</span>
            <div class="console-controls">
                <button onclick="toggleConsoleFilter()" id="console-filter-btn" title="Basculer filtre">🔍</button>
                <button onclick="clearMobileConsole()" title="Vider">🗑️</button>
                <button onclick="copyConsoleToClipboard()" title="Copier tout">📋</button>
                <button onclick="toggleConsoleAutoScroll()" id="console-autoscroll-btn" title="Auto-scroll">📜</button>
                <button onclick="closeMobileConsole()" title="Fermer">❌</button>
            </div>
        </div>
        <div class="console-content" id="console-content"></div>
        <div class="console-footer">
            <small>Erreurs & logs critiques uniquement • Auto-scroll: ON</small>
        </div>
    `;
    
    document.body.appendChild(mobileConsoleLogger);
    
    // Styles CSS inline pour éviter les dépendances
    const style = document.createElement('style');
    style.textContent = `
        #mobile-console-logger {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: 300px;
            background: #1a1a1a;
            border-top: 2px solid #333;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            z-index: 10000;
            display: none;
            flex-direction: column;
        }
        
        .console-header {
            background: #333;
            color: white;
            padding: 8px 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #555;
        }
        
        .console-controls button {
            background: #444;
            border: 1px solid #666;
            color: white;
            padding: 4px 8px;
            margin-left: 4px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }
        
        .console-controls button:hover {
            background: #555;
        }
        
        .console-content {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            background: #1a1a1a;
            color: #e0e0e0;
            white-space: pre-wrap;
            word-break: break-all;
        }
        
        .console-footer {
            background: #333;
            color: #999;
            padding: 4px 12px;
            border-top: 1px solid #555;
            text-align: center;
        }
        
        .console-log { color: #e0e0e0; }
        .console-error { color: #ff6b6b; }
        .console-warn { color: #ffd93d; }
        .console-info { color: #74c0fc; }
        .console-admin {
            color: #a78bfa;
            background: rgba(167, 139, 250, 0.1);
            padding: 2px 4px;
            border-left: 3px solid #a78bfa;
            margin: 2px 0;
            font-weight: bold;
        }
    `;
    document.head.appendChild(style);
}

// Afficher le logger mobile
function showMobileConsole() {
    createMobileConsoleLogger();
    mobileConsoleLogger.style.display = 'flex';
    updateMobileConsoleDisplay();
    
    // Auto-scroll vers le bas
    setTimeout(() => {
        const content = document.getElementById('console-content');
        content.scrollTop = content.scrollHeight;
    }, 100);
}

// Mettre à jour l'affichage du logger
function updateMobileConsoleDisplay() {
    const content = document.getElementById('console-content');
    if (!content) return;
    
    const shouldAutoScroll = content.scrollTop + content.clientHeight >= content.scrollHeight - 10;
    
    content.innerHTML = consoleHistory.map(entry => 
        `<div class="console-${entry.type}">${entry.full}</div>`
    ).join('\n');
    
    // Auto-scroll si on était déjà en bas
    if (shouldAutoScroll && window.consoleAutoScroll !== false) {
        content.scrollTop = content.scrollHeight;
    }
}

// Ajouter un log admin à la console mobile
function logAdminAction(message) {
    const timestamp = new Date().toLocaleTimeString();
    
    // Toujours afficher les logs admin, même avec le filtre activé
    consoleHistory.push({
        timestamp,
        type: 'admin',
        message,
        full: `[${timestamp}] 👑 ADMIN: ${message}`
    });
    
    // Limiter l'historique
    if (consoleHistory.length > maxConsoleHistory) {
        consoleHistory.shift();
    }
    
    // Mettre à jour le logger mobile s'il est ouvert
    if (mobileConsoleLogger && mobileConsoleLogger.style.display !== 'none') {
        updateMobileConsoleDisplay();
    }
    
    // Afficher aussi dans la vraie console
    console.log(`👑 [ADMIN] ${message}`);
}

// Fonctions de contrôle du logger
function clearMobileConsole() {
    consoleHistory = [];
    updateMobileConsoleDisplay();
}

function copyConsoleToClipboard() {
    const fullLog = consoleHistory.map(entry => entry.full).join('\n');
    
    if (navigator.clipboard) {
        navigator.clipboard.writeText(fullLog).then(() => {
            alert('📋 Console copiée dans le presse-papiers !');
        }).catch(() => {
            // Fallback pour anciens navigateurs
            fallbackCopyToClipboard(fullLog);
        });
    } else {
        fallbackCopyToClipboard(fullLog);
    }
}

function fallbackCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        alert('📋 Console copiée dans le presse-papiers !');
    } catch (err) {
        alert('❌ Impossible de copier automatiquement.\n\nAppuyez sur Ctrl+A puis Ctrl+C pour copier manuellement.');
        textArea.select();
    }
    
    document.body.removeChild(textArea);
}

function toggleConsoleAutoScroll() {
    window.consoleAutoScroll = !window.consoleAutoScroll;
    const btn = document.getElementById('console-autoscroll-btn');
    if (btn) {
        btn.style.background = window.consoleAutoScroll ? '#4CAF50' : '#444';
        btn.title = window.consoleAutoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF';
    }
}

function closeMobileConsole() {
    if (mobileConsoleLogger) {
        mobileConsoleLogger.style.display = 'none';
    }
}

function toggleConsoleFilter() {
    consoleFilterEnabled = !consoleFilterEnabled;
    
    const filterBtn = document.getElementById('console-filter-btn');
    const footer = document.querySelector('.console-footer small');
    
    if (consoleFilterEnabled) {
        filterBtn.textContent = '🔍';
        filterBtn.title = 'Filtre activé - Cliquer pour voir tous les logs';
        footer.textContent = 'Erreurs & logs critiques uniquement • Auto-scroll: ' + (window.consoleAutoScroll !== false ? 'ON' : 'OFF');
    } else {
        filterBtn.textContent = '📄';
        filterBtn.title = 'Tous les logs - Cliquer pour filtrer';
        footer.textContent = 'Tous les logs • Auto-scroll: ' + (window.consoleAutoScroll !== false ? 'ON' : 'OFF');
    }
    
    console.log(`🔍 Console mobile: Filtre ${consoleFilterEnabled ? 'activé' : 'désactivé'}`);
}

// ===== FIREBASE LOGGING FUNCTIONS =====

// Démarrer l'enregistrement des logs vers Firebase
async function startFirebaseLogging() {
    if (isFirebaseLoggingActive) {
        showNotification('⚠️ Logging déjà actif', 'warning');
        return;
    }
    
    if (!firebaseService) {
        showNotification('❌ Firebase non disponible', 'error');
        return;
    }
    
    if (!currentTeamId) {
        showNotification('❌ Équipe non connectée', 'error');
        return;
    }
    
    // Générer un ID de session unique
    firebaseLoggingSessionId = `session_${currentTeamId}_${Date.now()}`;
    isFirebaseLoggingActive = true;
    
    console.log(`📝 🔥 FIREBASE LOGGING DÉMARRÉ - Session: ${firebaseLoggingSessionId}`);
    showNotification('📝 Logging Firebase activé', 'success');
    
    // Sauvegarder immédiatement les logs actuels
    await saveLogsToFirebase();
    
    // Configurer l'envoi périodique
    firebaseLoggingInterval = setInterval(async () => {
        if (isFirebaseLoggingActive) {
            await saveLogsToFirebase();
        }
    }, FIREBASE_LOG_INTERVAL);
    
    // Mettre à jour les boutons
    updateFirebaseLoggingButtons();
}

// Arrêter l'enregistrement des logs vers Firebase
async function stopFirebaseLogging() {
    if (!isFirebaseLoggingActive) {
        showNotification('⚠️ Logging non actif', 'warning');
        return;
    }
    
    console.log(`📝 🔥 FIREBASE LOGGING ARRÊTÉ - Session: ${firebaseLoggingSessionId}`);
    
    // Sauvegarder une dernière fois avant d'arrêter
    await saveLogsToFirebase();
    
    // Arrêter l'intervalle
    if (firebaseLoggingInterval) {
        clearInterval(firebaseLoggingInterval);
        firebaseLoggingInterval = null;
    }
    
    isFirebaseLoggingActive = false;
    
    showNotification(`📝 Logging arrêté - Session: ${firebaseLoggingSessionId.substring(0, 20)}...`, 'info');
    
    // Afficher où retrouver les logs
    console.log(`📝 Logs sauvegardés dans Firebase sous l'ID: ${firebaseLoggingSessionId}`);
    console.log(`📝 Pour les retrouver: Collection 'debug_logs', sessionId: '${firebaseLoggingSessionId}'`);
    
    // Mettre à jour les boutons
    updateFirebaseLoggingButtons();
}

// Sauvegarder les logs actuels vers Firebase
async function saveLogsToFirebase() {
    if (!isFirebaseLoggingActive || !firebaseService || !currentTeamId) {
        return;
    }
    
    try {
        const logsToSave = consoleHistory.map(log => ({
            timestamp: log.timestamp,
            type: log.type,
            message: log.message
        }));
        
        const success = await firebaseService.saveDebugLogs(
            logsToSave,
            currentTeamId,
            firebaseLoggingSessionId
        );
        
        if (success) {
            console.log(`📝 ${logsToSave.length} logs envoyés à Firebase`);
        } else {
            console.error('❌ Échec de l\'envoi des logs à Firebase');
        }
    } catch (error) {
        console.error('❌ Erreur lors de la sauvegarde des logs:', error);
    }
}

// Mettre à jour l'apparence des boutons de logging
function updateFirebaseLoggingButtons() {
    const startBtn = document.getElementById('start-firebase-logging-btn');
    const stopBtn = document.getElementById('stop-firebase-logging-btn');
    const statusInfo = document.getElementById('logging-session-info');
    
    if (startBtn) {
        startBtn.disabled = isFirebaseLoggingActive;
        startBtn.style.opacity = isFirebaseLoggingActive ? '0.5' : '1';
    }
    
    if (stopBtn) {
        stopBtn.disabled = !isFirebaseLoggingActive;
        stopBtn.style.opacity = !isFirebaseLoggingActive ? '0.5' : '1';
    }
    
    if (statusInfo) {
        if (isFirebaseLoggingActive) {
            statusInfo.innerHTML = `
                <div style="color: #28a745; font-weight: bold;">
                    🟢 Logging ACTIF
                </div>
                <div style="margin-top: 5px; font-size: 10px;">
                    Session: ${firebaseLoggingSessionId ? firebaseLoggingSessionId.substring(0, 30) + '...' : 'N/A'}
                </div>
                <div style="font-size: 10px;">
                    ${consoleHistory.length} logs en mémoire
                </div>
            `;
        } else {
            statusInfo.innerHTML = `
                <div style="color: #6c757d;">
                    ⚫ Logging inactif
                </div>
                ${firebaseLoggingSessionId ? `
                <div style="margin-top: 5px; font-size: 10px;">
                    Dernière session: ${firebaseLoggingSessionId.substring(0, 30)}...
                </div>
                ` : ''}
            `;
        }
    }
}

// Télécharger les logs d'une session depuis Firebase
async function downloadFirebaseLogs() {
    if (!firebaseLoggingSessionId) {
        showNotification('❌ Aucune session de logging active ou récente', 'error');
        return;
    }
    
    if (!firebaseService) {
        showNotification('❌ Firebase non disponible', 'error');
        return;
    }
    
    try {
        showNotification('📥 Téléchargement des logs...', 'info');
        
        const logs = await firebaseService.getDebugLogs(firebaseLoggingSessionId);
        
        if (!logs || logs.length === 0) {
            showNotification('⚠️ Aucun log trouvé pour cette session', 'warning');
            return;
        }
        
        // Créer un fichier texte avec tous les logs
        let logText = `=== LOGS DEBUG - Session: ${firebaseLoggingSessionId} ===\n`;
        logText += `Équipe: ${currentTeam?.name || 'Inconnue'} (${currentTeamId})\n`;
        logText += `Nombre de snapshots: ${logs.length}\n`;
        logText += `Date de téléchargement: ${new Date().toLocaleString('fr-FR')}\n`;
        logText += `\n${'='.repeat(80)}\n\n`;
        
        logs.forEach((logSnapshot, index) => {
            logText += `--- Snapshot ${index + 1} (${new Date(logSnapshot.createdAt).toLocaleString('fr-FR')}) ---\n`;
            logSnapshot.logs.forEach(log => {
                logText += `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}\n`;
            });
            logText += '\n';
        });
        
        // Télécharger le fichier
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs_${firebaseLoggingSessionId}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        
        showNotification('✅ Logs téléchargés', 'success');
        console.log(`📥 Logs téléchargés: ${logs.length} snapshots`);
        
    } catch (error) {
        console.error('❌ Erreur téléchargement logs:', error);
        showNotification('❌ Erreur lors du téléchargement', 'error');
    }
}

// ===== FONCTIONS DE MONITORING =====

// Gestionnaire d'erreurs global
function logError(error, context = 'Unknown', critical = false) {
    const errorInfo = {
        timestamp: new Date().toISOString(),
        context: context,
        message: error.message || error,
        stack: error.stack,
        critical: critical,
        userAgent: navigator.userAgent,
        url: window.location.href,
        teamId: currentTeamId,
        teamName: currentTeam?.name
    };
    
    errorLog.push(errorInfo);
    performanceMetrics.errors++;
    
    // Log dans la console avec emoji selon la criticité
    const emoji = critical ? '💥' : '⚠️';
    console.error(`${emoji} [${context}]`, error);
    
    // Garder seulement les 50 dernières erreurs
    if (errorLog.length > 50) {
        errorLog.shift();
    }
    
    // Si erreur critique, envoyer notification
    if (critical) {
        showNotification(`Erreur critique: ${context}`, 'error');
    }
    
    return errorInfo;
}

// Health check du système
function healthCheck() {
    const timeSinceLastUpdate = lastFirebaseUpdate > 0 ? Date.now() - lastFirebaseUpdate : null;
    
    const checks = {
        timestamp: new Date().toISOString(),
        firebase: !!window.firebaseService,
        firebaseListener: {
            active: firebaseListenerActive,
            timeSinceLastUpdate: timeSinceLastUpdate ? Math.round(timeSinceLastUpdate / 1000) + 's' : 'jamais',
            fallbackActive: !!fallbackPollingInterval
        },
        geolocation: !!navigator.geolocation,
        network: navigator.onLine,
        localStorage: (() => {
            try {
                localStorage.setItem('test', 'test');
                localStorage.removeItem('test');
                return true;
            } catch (e) {
                return false;
            }
        })(),
        map: !!map,
        team: !!currentTeam,
        checkpoints: GAME_CONFIG.checkpoints?.length || 0,
        userPosition: !!userPosition,
        gpsLocked: gpsLockState.isLocked,
        gpsLockReason: gpsLockState.lockReason,
        gpsAccuracy: userPosition?.accuracy || null,
        errors: performanceMetrics.errors,
        uptime: Math.round((Date.now() - performanceMetrics.startTime) / 1000)
    };
    
    console.log('🏥 Health Check:', checks);
    return checks;
}

// Exécution sécurisée avec fallback
function safeExecute(fn, fallback, context = 'Unknown') {
    try {
        return fn();
    } catch (error) {
        logError(error, context, false);
        return fallback;
    }
}

// Wrapper pour les appels API
async function safeApiCall(apiCall, context = 'API Call') {
    performanceMetrics.apiCalls++;
    try {
        const result = await apiCall();
        console.log(`✅ [${context}] Succès`);
        return result;
    } catch (error) {
        logError(error, context, true);
        throw error;
    }
}

// Afficher les métriques (pour debug)
function showMetrics() {
    const metrics = {
        ...performanceMetrics,
        uptime: Math.round((Date.now() - performanceMetrics.startTime) / 1000),
        recentErrors: errorLog.slice(-5),
        health: healthCheck()
    };
    
    console.table(metrics);
    return metrics;
}

// Activer le mode debug (triple-clic sur le titre)
function enableDebugMode() {
    document.getElementById('debug-panel').style.display = 'block';
    console.log('🔧 Mode debug activé ! Utilisez les boutons en haut à droite.');
    showNotification('🔧 Mode debug activé !', 'success');
}

// Triple-clic sur le titre pour activer le debug
let titleClickCount = 0;
let touchStartTime = 0;

document.addEventListener('DOMContentLoaded', () => {
    const title = document.querySelector('h1');
    if (title) {
        // Triple-clic pour menu debug unifié (desktop)
        title.addEventListener('click', () => {
            titleClickCount++;
            if (titleClickCount >= 3) {
                showUnifiedDebugMenu();
                showNotification('🛠️ Menu debug activé !', 'success');
                titleClickCount = 0;
            }
            setTimeout(() => titleClickCount = 0, 2000);
        });
        
        // Appui long pour menu debug unifié
        title.addEventListener('touchstart', (e) => {
            touchStartTime = Date.now();
        });
        
        title.addEventListener('touchend', (e) => {
            const touchDuration = Date.now() - touchStartTime;
            if (touchDuration >= 1000) { // Appui long de 1 seconde
                e.preventDefault();
                showUnifiedDebugMenu();
                showNotification('🛠️ Menu debug activé !', 'success');
            }
        });
        
        // Empêcher le menu contextuel sur appui long
        title.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }
});

// ===== DÉTECTION NAVIGATEUR CENTRALISÉE =====
const BROWSER_INFO = {
    userAgent: navigator.userAgent,
    isSafari: false,
    isIOS: false,
    isChrome: false,
    isFirefox: false,
    isMobile: false,
    isDesktop: false,
    name: 'unknown',
    version: 'unknown'
};

// Initialiser la détection du navigateur une seule fois
function initializeBrowserDetection() {
    // TOUJOURS récupérer le User Agent actuel (pas de cache)
    const currentUserAgent = navigator.userAgent;
    const ua = currentUserAgent.toLowerCase();
    
    // Réinitialiser complètement BROWSER_INFO
    window.BROWSER_INFO = {
        userAgent: currentUserAgent
    };
    
    // Détection Safari (attention aux faux positifs - Chrome sur iOS contient "safari")
    BROWSER_INFO.isSafari = /safari/.test(ua) && !/chrome/.test(ua) && !/chromium/.test(ua) && !/crios/.test(ua);
    
    // Détection iOS
    BROWSER_INFO.isIOS = /ipad|iphone|ipod/.test(ua);
    
    // Détection Chrome (attention : Chrome sur iOS contient "CriOS")
    BROWSER_INFO.isChrome = (/chrome/.test(ua) || /crios/.test(ua)) && !/edge/.test(ua) && !/opr/.test(ua);
    
    // Détection Firefox
    BROWSER_INFO.isFirefox = /firefox/.test(ua);
    
    // Détection mobile/desktop
    BROWSER_INFO.isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
    BROWSER_INFO.isDesktop = !BROWSER_INFO.isMobile;
    
    // Nom du navigateur
    if (BROWSER_INFO.isChrome) BROWSER_INFO.name = 'Chrome';
    else if (BROWSER_INFO.isSafari) BROWSER_INFO.name = 'Safari';
    else if (BROWSER_INFO.isFirefox) BROWSER_INFO.name = 'Firefox';
    else if (BROWSER_INFO.isIOS) BROWSER_INFO.name = 'iOS Safari';
    
    // Log de debug
    console.log('🌐 Détection navigateur initialisée:', {
        name: BROWSER_INFO.name,
        isSafari: BROWSER_INFO.isSafari,
        isIOS: BROWSER_INFO.isIOS,
        isChrome: BROWSER_INFO.isChrome,
        isFirefox: BROWSER_INFO.isFirefox,
        isMobile: BROWSER_INFO.isMobile,
        userAgent: BROWSER_INFO.userAgent
    });
}

// ===== PROTECTION ANTI-RECHARGEMENT =====
let gameStarted = false;
let gameProtectionActive = false;

// ===== GESTION DES PERMISSIONS =====
async function requestAllPermissions() {
    console.log('🔐 Demande de toutes les permissions...');
    
    const permissions = {
        geolocation: false,
        camera: false,
        microphone: false
    };
    
    try {
        // 1. Géolocalisation (obligatoire pour le jeu)
        try {
            await requestGeolocationBrowser();
            permissions.geolocation = true;
            console.log('✅ Permission géolocalisation accordée');
        } catch (error) {
            console.warn('⚠️ Géolocalisation non disponible:', error.message);
        }
        
        // 2. Caméra (pour les épreuves photo)
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const videoStream = await requestCameraBrowser();
                permissions.camera = true;
                console.log('✅ Permission caméra accordée');
                // Arrêter le stream immédiatement
                videoStream.getTracks().forEach(track => track.stop());
            } catch (error) {
                console.warn('⚠️ Permission caméra refusée:', error.message);
            }
        }
        
        // 3. Microphone (pour les épreuves audio)
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const audioStream = await requestMicrophoneBrowser();
                permissions.microphone = true;
                console.log('✅ Permission microphone accordée');
                // Arrêter le stream immédiatement
                audioStream.getTracks().forEach(track => track.stop());
            } catch (error) {
                console.warn('⚠️ Permission microphone refusée:', error.message);
            }
        }
        
        // Afficher un résumé des permissions
        const granted = Object.values(permissions).filter(p => p).length;
        const total = Object.keys(permissions).length;
        
        if (granted === total) {
            showNotification('🎉 Toutes les permissions accordées !', 'success');
        } else if (granted > 0) {
            showNotification(`⚠️ ${granted}/${total} permissions accordées`, 'warning');
        } else {
            showNotification('❌ Aucune permission accordée', 'error');
        }
        
        // Afficher les détails pour debug
        console.log('🔐 État des permissions:', permissions);
        
        return permissions;
        
    } catch (error) {
        logError(error, 'Permission Request', false);
        console.warn('⚠️ Erreur lors de la demande de permissions:', error);
        return permissions;
    }
}

// Fonction pour détecter Safari et donner des conseils spécifiques
function showSafariPermissionTips() {
    if (BROWSER_INFO.isSafari || BROWSER_INFO.isIOS) {
        let tips;
        
        if (BROWSER_INFO.isChrome && BROWSER_INFO.isIOS) {
            tips = [
                '📱 Sur Chrome iOS :',
                '• Géolocalisation : Réglages > Confidentialité > Service de localisation > Chrome',
                '• Caméra : Réglages > Chrome > Caméra',
                '• Microphone : Réglages > Chrome > Microphone',
                '• Si problèmes persistent : Redémarrer Chrome ou l\'iPhone'
            ];
        } else {
            tips = [
                '📱 Sur Safari/iOS :',
                '• Géolocalisation : Réglages > Safari > Localisation',
                '• Caméra : Réglages > Safari > Caméra',
                '• Microphone : Réglages > Safari > Microphone',
                '• Ou utilisez Chrome/Firefox pour une meilleure compatibilité'
            ];
        }
        
        console.log('🍎 Conseils iOS détectés:', tips.join('\n'));
        
        // Afficher une notification spéciale pour Safari
        setTimeout(() => {
            showNotification('🍎 Safari détecté - Vérifiez les réglages si problème', 'info');
        }, 2000);
    }
}

// Fonction pour vérifier les permissions en temps réel
async function checkPermissionsStatus() {
    const status = {
        geolocation: 'unknown',
        camera: 'unknown',
        microphone: 'unknown'
    };
    
    try {
        // Vérifier avec l'API Permissions si disponible
        if (navigator.permissions) {
            try {
                const geoPermission = await navigator.permissions.query({ name: 'geolocation' });
                status.geolocation = geoPermission.state;
            } catch (e) { /* Pas supporté */ }
            
            try {
                const cameraPermission = await navigator.permissions.query({ name: 'camera' });
                status.camera = cameraPermission.state;
            } catch (e) { /* Pas supporté */ }
            
            try {
                const micPermission = await navigator.permissions.query({ name: 'microphone' });
                status.microphone = micPermission.state;
            } catch (e) { /* Pas supporté */ }
        }
    } catch (error) {
        console.warn('⚠️ API Permissions non disponible');
    }
    
    console.log('🔐 État actuel des permissions:', status);
    return status;
}

// ===== FONCTIONS SPÉCIALISÉES PAR NAVIGATEUR =====

// Géolocalisation adaptée au navigateur
async function requestGeolocationBrowser() {
    // Diagnostics mobiles spécialisés
    if (BROWSER_INFO.isMobile) {
        console.log('📱 Diagnostics géolocalisation mobile:');
        console.log('  - User Agent:', navigator.userAgent);
        console.log('  - Geolocation disponible:', !!navigator.geolocation);
        console.log('  - HTTPS:', location.protocol === 'https:');
        console.log('  - Permissions API:', !!navigator.permissions);
        
        // Vérification permissions en temps réel
        if (navigator.permissions) {
            try {
                const permission = await navigator.permissions.query({name: 'geolocation'});
                console.log('  - Permission géolocalisation:', permission.state);
                
                if (permission.state === 'denied') {
                    console.warn('⚠️ Permission géolocalisation refusée - Fallback manuel');
                    throw new Error('PERMISSION_DENIED');
                }
            } catch (permError) {
                console.warn('⚠️ Impossible de vérifier les permissions:', permError);
            }
        }
    }
    
    const options = {
        enableHighAccuracy: true,
        timeout: BROWSER_INFO.isMobile ? 25000 : (BROWSER_INFO.isSafari || BROWSER_INFO.isIOS ? 15000 : 10000),
        maximumAge: BROWSER_INFO.isMobile ? 30000 : 300000
    };
    
    console.log(`📍 Demande géolocalisation optimisée pour ${BROWSER_INFO.name}:`, options);
    
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Géolocalisation non supportée'));
            return;
        }
        
        // Timeout de sécurité supplémentaire pour mobile
        const safetyTimeout = setTimeout(() => {
            console.error('⏰ Timeout sécurité géolocalisation mobile');
            reject(new Error('MOBILE_TIMEOUT'));
        }, options.timeout + 5000);
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                clearTimeout(safetyTimeout);
                console.log(`✅ Géolocalisation ${BROWSER_INFO.name} réussie:`, position.coords);
                console.log('📍 Précision GPS:', position.coords.accuracy, 'mètres');
                
                // Validation mobile spéciale
                if (BROWSER_INFO.isMobile && position.coords.accuracy > 1000) {
                    console.warn('⚠️ Précision GPS faible sur mobile:', position.coords.accuracy, 'm');
                }
                
                resolve(position);
            },
            async (error) => {
                clearTimeout(safetyTimeout);
                console.error(`❌ Géolocalisation ${BROWSER_INFO.name} échouée:`, error);
                console.error('  - Code erreur:', error.code);
                console.error('  - Message:', error.message);
                
                // Fallback mobile spécialisé
                if (BROWSER_INFO.isMobile) {
                    console.log('🔄 Tentative fallback mobile...');
                    try {
                        const fallbackPosition = await tryMobileFallbackGeolocation();
                        resolve(fallbackPosition);
                        return;
                    } catch (fallbackError) {
                        console.error('❌ Fallback mobile échoué:', fallbackError);
                    }
                }
                
                reject(error);
            },
            options
        );
    });
}

// Fallback géolocalisation mobile spécialisé
async function tryMobileFallbackGeolocation() {
    console.log('🔄 Fallback géolocalisation mobile...');
    
    // Essai avec options dégradées
    const fallbackOptions = {
        enableHighAccuracy: false, // Précision réduite mais plus rapide
        timeout: 15000,
        maximumAge: 120000 // Cache plus long
    };
    
    console.log('📍 Tentative avec précision réduite:', fallbackOptions);
    
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('✅ Fallback mobile réussi (précision réduite):', position.coords);
                resolve(position);
            },
            (error) => {
                console.error('❌ Fallback mobile échoué:', error);
                
                // Dernier recours : position manuelle
                console.log('🆘 Dernier recours: position manuelle');
                showMobileGeolocationHelp();
                reject(error);
            },
            fallbackOptions
        );
    });
}

// Interface d'aide géolocalisation mobile
function showMobileGeolocationHelp() {
    const helpHTML = `
        <div class="mobile-geo-help">
            <h3>🆘 Problème de géolocalisation</h3>
            <p><strong>Chrome mobile</strong> a des difficultés à vous localiser.</p>
            
            <div class="geo-help-steps">
                <h4>✅ Vérifications rapides :</h4>
                <ol>
                    <li>📍 <strong>GPS activé</strong> dans les paramètres du téléphone</li>
                    <li>🌐 <strong>Localisation autorisée</strong> pour Chrome</li>
                    <li>📶 <strong>Connexion réseau</strong> stable</li>
                    <li>🔋 <strong>Mode économie d'énergie</strong> désactivé</li>
                </ol>
                
                <h4>🔧 Solutions :</h4>
                <button onclick="retryMobileGeolocation()" class="btn btn-primary">
                    🔄 Réessayer la géolocalisation
                </button>
                <button onclick="showGeolocationFallback()" class="btn btn-secondary">
                    📍 Saisir position manuellement
                </button>
            </div>
        </div>
    `;
    
    showModal('Aide Géolocalisation Mobile', helpHTML);
}

// Fermeture sécurisée des modals
function closeModal() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
    
    // Nettoyer les modals actifs
    activeModals.clear();
    
    // Arrêter les flux audio/vidéo si nécessaire
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
        isAudioChallengeActive = false;
    }
    
    // Arrêter les flux vidéo si nécessaire
    const videoElement = document.getElementById('camera-video');
    if (videoElement && videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
    }
    
    console.log('🚫 Modals fermés et flux média arrêtés');
}

// Retry géolocalisation mobile
async function retryMobileGeolocation() {
    try {
        closeModal();
        console.log('🔄 Nouvelle tentative géolocalisation mobile...');
        
        const position = await requestGeolocationBrowser();
        onLocationSuccess(position);
        
    } catch (error) {
        console.error('❌ Retry géolocalisation échoué:', error);
        showGeolocationFallback();
    }
}

// Caméra adaptée au navigateur
async function requestCameraBrowser() {
    const constraints = {
        video: {
            facingMode: 'environment', // Caméra arrière par défaut
            width: { ideal: BROWSER_INFO.isMobile ? 720 : 1280 },
            height: { ideal: BROWSER_INFO.isMobile ? 480 : 720 }
        }
    };
    
    // Contraintes spéciales pour Safari
    if (BROWSER_INFO.isSafari || BROWSER_INFO.isIOS) {
        constraints.video.width = { ideal: 640 };
        constraints.video.height = { ideal: 480 };
    }
    
    console.log(`📸 Demande caméra optimisée pour ${BROWSER_INFO.name}:`, constraints);
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log(`✅ Caméra ${BROWSER_INFO.name} accordée`);
        return stream;
    } catch (error) {
        console.warn(`⚠️ Erreur caméra ${BROWSER_INFO.name}:`, error);
        throw error;
    }
}

// Microphone adapté au navigateur
async function requestMicrophoneBrowser() {
    const constraints = {
        audio: {
            echoCancellation: BROWSER_INFO.isSafari ? true : false, // Safari préfère avec
            noiseSuppression: BROWSER_INFO.isSafari ? true : false,
            autoGainControl: BROWSER_INFO.isSafari ? true : false,
            sampleRate: BROWSER_INFO.isSafari ? 44100 : 48000
        }
    };
    
    console.log(`🎤 Demande microphone optimisée pour ${BROWSER_INFO.name}:`, constraints);
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log(`✅ Microphone ${BROWSER_INFO.name} accordé`);
        return stream;
    } catch (error) {
        console.warn(`⚠️ Erreur microphone ${BROWSER_INFO.name}:`, error);
        throw error;
    }
}

// Activer la protection quand le jeu commence
function enableGameProtection() {
    if (gameProtectionActive) return;
    
    gameProtectionActive = true;
    console.log('🛡️ Protection anti-rechargement activée');
    
    console.log('🌐 Navigateur détecté:', BROWSER_INFO.name);
    
    // ===== ANCIENS HANDLERS BEFOREUNLOAD DÉSACTIVÉS =====
    // COMMENTÉ : beforeunload ne fonctionne pas bien sur mobile (surtout iOS)
    // Maintenant géré par visibilitychange dans setupEnhancedVisibilityHandler()
    /*
    const beforeUnloadHandler = (event) => {
        if (gameStarted && currentTeam) {
            const message = '⚠️ Êtes-vous sûr de vouloir quitter ? Votre progression sera sauvegardée mais vous devrez vous reconnecter.';
            
            if (BROWSER_INFO.isSafari || BROWSER_INFO.isIOS) {
                console.log('🍎 Safari: Tentative de protection beforeunload');
                event.preventDefault();
                event.returnValue = '';
                return '';
            } else {
                event.preventDefault();
                event.returnValue = message;
                return message;
            }
        }
    };
    
    window.addEventListener('beforeunload', beforeUnloadHandler);
    */
    
    // Protection navigation arrière (mobile)
    const popStateHandler = (event) => {
        if (gameStarted && currentTeam) {
            const confirmLeave = confirm('⚠️ Voulez-vous vraiment quitter le jeu ? Votre progression sera sauvegardée.');
            if (!confirmLeave) {
                // Remettre l'état dans l'historique
                history.pushState(null, null, window.location.href);
            } else {
                // L'utilisateur confirme, on peut nettoyer
                disableGameProtection();
            }
        }
    };
    
    window.addEventListener('popstate', popStateHandler);
    
    // ===== ANCIEN SYSTÈME SAFARI DÉSACTIVÉ (remplacé par setupEnhancedVisibilityHandler) =====
    // Protection spéciale Safari avec visibilitychange
    // COMMENTÉ : Maintenant géré par setupEnhancedVisibilityHandler() qui est plus robuste
    
    // Stocker seulement popStateHandler (beforeUnload commenté)
    window.gameProtectionHandlers = {
        // beforeUnload: beforeUnloadHandler, // DÉSACTIVÉ
        popState: popStateHandler
    };
    
    // Ajouter un état dans l'historique pour capturer le retour
    history.pushState(null, null, window.location.href);
}

// Désactiver la protection (fin de jeu)
function disableGameProtection() {
    gameProtectionActive = false;
    gameStarted = false;
    
    // Supprimer tous les event listeners
    if (window.gameProtectionHandlers) {
        if (window.gameProtectionHandlers.beforeUnload) {
            window.removeEventListener('beforeunload', window.gameProtectionHandlers.beforeUnload);
        }
        if (window.gameProtectionHandlers.popState) {
            window.removeEventListener('popstate', window.gameProtectionHandlers.popState);
        }
        if (window.gameProtectionHandlers.visibility) {
            document.removeEventListener('visibilitychange', window.gameProtectionHandlers.visibility);
        }
        if (window.gameProtectionHandlers.pageHide) {
            window.removeEventListener('pagehide', window.gameProtectionHandlers.pageHide);
        }
        
        // Nettoyer la référence
        delete window.gameProtectionHandlers;
    }
    
    console.log('🔓 Protection anti-rechargement désactivée');
}

// Déconnexion propre de l'équipe
function disconnectTeam() {
    console.log('🚪 Déconnexion de l\'équipe...');
    
    try {
        // Désactiver la protection avant de déconnecter
        disableGameProtection();
        
        // ===== NOUVEAU: Arrêter l'auto-save =====
        stopAutoSave();
        
        // ===== NOUVEAU: Arrêter le GPS =====
        if (gpsWatchId !== null) {
            navigator.geolocation.clearWatch(gpsWatchId);
            gpsWatchId = null;
        }
        
        // ===== NOUVEAU: Nettoyer les listeners de notifications =====
        if (helpRequestsListenerUnsubscribe) {
            helpRequestsListenerUnsubscribe();
            helpRequestsListenerUnsubscribe = null;
        }
        if (validationsListenerUnsubscribe) {
            validationsListenerUnsubscribe();
            validationsListenerUnsubscribe = null;
        }
        
        // Nettoyer les données locales
        safeLocalStorage().removeItem('currentTeamId');
        safeLocalStorage().removeItem('gameState');
        safeLocalStorage().removeItem('gameState_backup');
        
        // Réinitialiser les variables
        currentTeam = null;
        currentTeamId = null;
        foundCheckpoints = [];
        unlockedCheckpoints = [0];
        gameStarted = false;
        discoveredCheckpoints.clear(); // Réinitialiser les checkpoints découverts
        notificationListenersConfigured = false; // Reset le flag des listeners
        
        // Réinitialiser les métriques de save
        saveMetrics = {
            totalSaves: 0,
            skippedSaves: 0,
            failedSaves: 0,
            lastError: null
        };
        saveHistory = [];
        lastSavedState = null;
        lastSaveTime = 0;
        
        // Nettoyer la carte
        if (map) {
            checkpointMarkers.forEach(markerData => {
                if (markerData.marker) {
                    map.removeLayer(markerData.marker);
                }
                if (markerData.circle) {
                    map.removeLayer(markerData.circle);
                }
            });
            checkpointMarkers = [];
            
            if (currentRoute) {
                map.removeLayer(currentRoute);
                currentRoute = null;
            }
        }
        
        // Masquer les infos équipe
        document.getElementById('team-info').style.display = 'none';
        
        // Réafficher le modal de connexion
        showTeamLoginModal();
        
        // Notification de déconnexion
        showNotification('🚪 Déconnexion réussie', 'success');
        
        console.log('✅ Déconnexion terminée');
        
    } catch (error) {
        logError(error, 'Team Disconnect', true);
        showNotification('Erreur lors de la déconnexion', 'error');
    }
}

// Exposer les fonctions de monitoring globalement
window.healthCheck = healthCheck;
window.showMetrics = showMetrics;
window.errorLog = errorLog;
window.enableDebugMode = enableDebugMode;
window.disableGameProtection = disableGameProtection;

// Fonction pour décoder une polyline encodée
function decodePolyline(encoded) {
    const poly = [];
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lng = 0;

    while (index < len) {
        let b;
        let shift = 0;
        let result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        poly.push([lng / 1e5, lat / 1e5]);
    }
    return poly;
}

// Configuration des équipes
const TEAMS = {
    team1: {
        name: "🔴 Équipe Rouge",
        color: "#e74c3c",
        route: [1, 2] // Ordre des checkpoints pour cette équipe
    },
    team2: {
        name: "🔵 Équipe Bleue", 
        color: "#3498db",
        route: [2, 1] // Ordre différent pour cette équipe
    },
    team3: {
        name: "🟢 Équipe Verte",
        color: "#27ae60", 
        route: [1, 2] // Même que rouge pour l'instant
    },
    team4: {
        name: "🟡 Équipe Jaune",
        color: "#f1c40f",
        route: [2, 1] // Même que bleue pour l'instant
    }
};

// Initialisation de l'application
// ===== INITIALISATION DU MONITORING =====

// Gestionnaire d'erreurs global
window.addEventListener('error', (event) => {
    // Filtrer les erreurs "Script error" génériques qui ne sont pas informatifs
    // Ces erreurs viennent souvent de scripts externes, extensions navigateur, ou restrictions CORS
    const errorMessage = event.error?.message || event.message || '';
    if (errorMessage === 'Script error.' || errorMessage === 'Script error') {
        console.warn('⚠️ Erreur script générique ignorée (probablement externe/CORS)');
        return;
    }
    
    // Filtrer aussi les erreurs sans stack trace et sans contexte
    if (!event.error && typeof event.message === 'string' && event.message.length < 20) {
        console.warn('⚠️ Erreur générique ignorée:', event.message);
        return;
    }
    
    logError(event.error || event.message, 'Global Error Handler', true);
});

// Gestionnaire d'erreurs pour les promesses non catchées
window.addEventListener('unhandledrejection', (event) => {
    logError(event.reason, 'Unhandled Promise Rejection', true);
});

// Health check automatique toutes les 30 secondes
setInterval(() => {
    const health = healthCheck();
    // Si trop d'erreurs, alerter
    if (health.errors > 10) {
        console.warn('🚨 Trop d\'erreurs détectées:', health.errors);
    }
}, 30000);

// Enregistrer le Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('✅ Service Worker enregistré:', registration.scope);
                
                // Écouter les mises à jour
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showNotification('🔄 Mise à jour disponible ! Rechargez la page.', 'info');
                        }
                    });
                });
            })
            .catch(error => {
                logError(error, 'Service Worker Registration', false);
            });
    });
}

// Détecter les changements de connexion
window.addEventListener('online', () => {
    console.log('🌐 Connexion rétablie');
    showNotification('🌐 Connexion rétablie', 'success');
    performanceMetrics.networkStatus = 'online';
});

window.addEventListener('offline', () => {
    console.log('📴 Mode hors ligne');
    showNotification('📴 Mode hors ligne - Fonctionnalités limitées', 'warning');
    performanceMetrics.networkStatus = 'offline';
});

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Démarrage du jeu avec monitoring activé');
    initializeApp();
});

async function initializeApp() {
    // Éviter la double initialisation MAIS permettre la reconnexion des listeners
    if (window.appInitialized) {
        console.log('⚠️ App déjà initialisée, vérification de la connexion équipe...');
        // Vérifier si une équipe est connectée et reconfigurer les listeners si besoin
        checkTeamLogin();
        return;
    }
    window.appInitialized = true;
    
    console.log('🚀 Initialisation du jeu de piste...');
    
    // Initialiser le logger mobile console
    initializeMobileConsoleLogger();
    
    // ✅ LOG DE VERSION - S'affiche dès le démarrage dans les logs mobile
    console.log('✅✅✅ VERSION 18:58 CHARGÉE - FIX BOUTON FERMETURE ÉNIGME ✅✅✅');
    
    // Initialiser la détection du navigateur en premier
    initializeBrowserDetection();
    
    // Demander toutes les permissions dès le début
    await requestAllPermissions();
    
    // Afficher les conseils Safari/iOS si nécessaire (même pour Chrome sur iOS)
    if (BROWSER_INFO.isSafari || BROWSER_INFO.isIOS) {
        showSafariPermissionTips();
    }
    
    // Initialiser Firebase Service
    if (window.firebaseService) {
        firebaseService = window.firebaseService;
        console.log('✅ Firebase Service initialisé');
    } else {
        console.warn('⚠️ Firebase Service non disponible - mode hors ligne');
    }
    
    // Initialiser le menu mobile
    initMobileMenu();
    
    // Vérifier si une équipe est connectée
    checkTeamLogin();
}

function checkTeamLogin() {
    // ===== ANCIEN: checkSafariEmergencyBackup() désactivé =====
    // Maintenant la récupération se fait automatiquement via Firebase + localStorage
    
    console.log('🔍 checkTeamLogin appelé', {
        currentTeamId: currentTeamId,
        firebaseService: !!firebaseService
    });
    
    // ✅ SI L'ÉQUIPE EST DÉJÀ CONNECTÉE EN MÉMOIRE, RECONFIGURER LES LISTENERS
    if (currentTeamId && firebaseService) {
        console.log('🔄 Équipe déjà connectée en mémoire, reconfiguration des listeners...');
        setupNotificationListeners();
        return;
    }
    
    // ⚠️ VÉRIFIER QUE FIREBASE EST PRÊT AVANT DE CHARGER LES DONNÉES
    if (!firebaseService) {
        console.warn('⚠️ Firebase Service pas encore prêt, affichage modal de connexion');
        showTeamLoginModal();
        return;
    }
    
    // Vérifier si une équipe est déjà connectée avec gestion d'erreurs
    const savedTeamId = safeExecute(
        () => localStorage.getItem('currentTeamId'),
        null,
        'LocalStorage Read'
    );
    
    if (savedTeamId) {
        // Équipe déjà connectée, charger ses données
        console.log('📂 Chargement équipe depuis localStorage:', savedTeamId);
        loadTeamData(savedTeamId);
    } else {
        // Pas d'équipe connectée, afficher le modal de connexion
        console.log('🚪 Aucune équipe connectée, affichage modal login');
        showTeamLoginModal();
    }
}

// ===== ANCIEN SYSTÈME SAFARI EMERGENCY BACKUP DÉSACTIVÉ =====
// COMMENTÉ : Maintenant remplacé par l'auto-save hybride + localStorage
// La récupération se fait automatiquement via Firebase + localStorage dans loadTeamGameData()
/*
function checkSafariEmergencyBackup() {
    try {
        const backup = safeLocalStorage().getItem('safariEmergencyBackup');
        if (backup) {
            const backupData = JSON.parse(backup);
            const timeDiff = Date.now() - backupData.timestamp;
            
            if (timeDiff < 5 * 60 * 1000) {
                console.log('🍎 Sauvegarde d\'urgence Safari trouvée:', backupData);
                
                const restore = confirm(
                    '🍎 Safari a détecté une fermeture inattendue.\n' +
                    'Voulez-vous récupérer votre progression ?\n\n' +
                    `Équipe: ${backupData.teamId}\n` +
                    `Checkpoints trouvés: ${backupData.foundCheckpoints.length}\n` +
                    `Sauvegardé il y a: ${Math.round(timeDiff / 1000)} secondes`
                );
                
                if (restore) {
                    safeLocalStorage().setItem('currentTeamId', backupData.teamId);
                    setTimeout(() => {
                        showNotification('🍎 Progression Safari récupérée !', 'success');
                    }, 1000);
                    console.log('✅ Progression Safari restaurée');
                }
            }
            
            safeLocalStorage().removeItem('safariEmergencyBackup');
        }
    } catch (error) {
        console.warn('⚠️ Erreur lors de la vérification de la sauvegarde Safari:', error);
        safeLocalStorage().removeItem('safariEmergencyBackup');
    }
}
*/

// Wrapper sécurisé pour localStorage
function safeLocalStorage() {
    return {
        getItem: (key) => safeExecute(
            () => localStorage.getItem(key),
            null,
            `LocalStorage.getItem(${key})`
        ),
        setItem: (key, value) => safeExecute(
            () => localStorage.setItem(key, value),
            false,
            `LocalStorage.setItem(${key})`
        ),
        removeItem: (key) => safeExecute(
            () => localStorage.removeItem(key),
            false,
            `LocalStorage.removeItem(${key})`
        ),
        isAvailable: () => {
            try {
                const test = 'localStorage_test';
                localStorage.setItem(test, test);
                localStorage.removeItem(test);
                return true;
            } catch (e) {
                return false;
            }
        }
    };
}

function showTeamLoginModal() {
    const modal = document.getElementById('user-login-modal');
    modal.style.setProperty('display', 'flex', 'important');
    
    // Configurer les événements de connexion
    setupLoginEvents();
}

function setupLoginEvents() {
    const userIdInput = document.getElementById('user-id');
    const passwordInput = document.getElementById('user-password');
    const loginBtn = document.getElementById('login-btn');
    
    // Activer/désactiver le bouton selon les champs
    function updateLoginButton() {
        const hasUserId = userIdInput.value.trim().length > 0;
        const hasPassword = passwordInput.value.length > 0;
        loginBtn.disabled = !(hasUserId && hasPassword);
    }
    
    userIdInput.addEventListener('input', updateLoginButton);
    passwordInput.addEventListener('input', updateLoginButton);
    
    // Connexion avec Enter
    [userIdInput, passwordInput].forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !loginBtn.disabled) {
                handleUserLogin();
            }
        });
    });
    
    // Connexion avec le bouton
    loginBtn.addEventListener('click', handleUserLogin);
}

// Gestion de la connexion équipe (plus de users !)
async function handleUserLogin() {
    const teamName = document.getElementById('user-id').value.trim();
    const password = document.getElementById('user-password').value;
    const errorDiv = document.getElementById('login-error');
    const loadingDiv = document.getElementById('login-loading');
    
    try {
        // Afficher le loading
        errorDiv.style.display = 'none';
        loadingDiv.style.display = 'block';
        
        // Vérifier les identifiants de l'équipe dans Firebase
        const team = await safeApiCall(
            () => firebaseService.authenticateTeam(teamName, password),
            'Team Authentication'
        );
        
        if (team) {
            // Connexion réussie
            currentTeam = team;
            currentTeamId = team.id;
            safeLocalStorage().setItem('currentTeamId', team.id);
            
            // Cacher le modal de connexion
            const loginModal = document.getElementById('user-login-modal');
            loginModal.style.setProperty('display', 'none', 'important');
            
            // Charger les données de l'équipe
            await loadTeamGameData();
            
            showNotification(`Bienvenue équipe ${team.name} !`, 'success');
            
        } else {
            showLoginError('Nom d\'équipe ou mot de passe incorrect');
        }
        
    } catch (error) {
        logError(error, 'Team Login', true);
        showLoginError('Erreur de connexion. Veuillez réessayer.');
    } finally {
        loadingDiv.style.display = 'none';
    }
}

// Charger les données équipe depuis Firebase
async function loadTeamData(teamId) {
    try {
        // Double vérification de sécurité
        if (!firebaseService) {
            console.error('❌ Firebase Service non disponible dans loadTeamData');
            showTeamLoginModal();
            return;
        }
        
        const team = await firebaseService.getTeam(teamId);
        if (team) {
            currentTeam = team;
            currentTeamId = teamId;
            await loadTeamGameData();
        } else {
            // Équipe non trouvée, déconnecter
            safeLocalStorage().removeItem('currentTeamId');
            showTeamLoginModal();
        }
    } catch (error) {
        logError(error, 'Load Team Data', true);
        safeLocalStorage().removeItem('currentTeamId');
        showTeamLoginModal();
    }
}

// Charger les données de jeu de l'équipe
async function loadTeamGameData() {
    if (!currentTeam) {
        console.error('❌ Aucune équipe actuelle pour charger les données de jeu');
        return;
    }
    
    try {
        // Vérifier que l'équipe a une route valide
        if (!currentTeam.route || currentTeam.route.length === 0) {
            console.error('❌ L\'équipe n\'a pas de parcours défini:', currentTeam);
            showNotification('❌ Parcours non configuré pour votre équipe. Contactez l\'administrateur.', 'error');
            return;
        }
        
        // Restaurer la progression avec des valeurs par défaut sûres
        foundCheckpoints = currentTeam.foundCheckpoints || [];
        unlockedCheckpoints = currentTeam.unlockedCheckpoints || [0];
        
        // Vérifier la cohérence des données
        if (!Array.isArray(foundCheckpoints)) foundCheckpoints = [];
        if (!Array.isArray(unlockedCheckpoints)) unlockedCheckpoints = [0];
        
        // S'assurer que le lobby (0) est toujours débloqué
        if (!unlockedCheckpoints.includes(0)) {
            unlockedCheckpoints.unshift(0);
        }
        
        // Afficher les infos de l'équipe
        showTeamInfo();
        
        // Démarrer le jeu (attendre que les checkpoints soient chargés)
        await startGame();
        
        // Démarrer la synchronisation temps réel avec l'équipe
        console.log('📞 [DEBUG] Appel à startTeamSync()...');
        startTeamSync();
        console.log('✅ [DEBUG] startTeamSync() terminé');
        
        // ✅ FORCER la configuration des listeners MAINTENANT
        console.log('🔧 [FORCE] Configuration FORCÉE des listeners depuis loadTeamGameData');
        setupNotificationListeners();
        
        // Démarrer la surveillance des modifications de checkpoints
        startCheckpointWatcher();
        
        // Activer la protection anti-rechargement maintenant que le jeu a commencé
        gameStarted = true;
        enableGameProtection();
        
        // ===== NOUVEAU: Démarrer l'auto-save intelligent =====
        startAutoSave();
        
        // ===== NOUVEAU: Installer le handler visibilitychange amélioré =====
        setupEnhancedVisibilityHandler();
        // Notification discrète dans la console seulement
        console.log('🛡️ Protection anti-rechargement activée - Le jeu vous demandera confirmation avant de quitter');
        
        console.log(`✅ Équipe ${currentTeam.name} connectée`, {
            foundCheckpoints,
            unlockedCheckpoints,
            teamRoute: currentTeam.route
        });
        
    } catch (error) {
        console.error('❌ Erreur lors du chargement des données de jeu:', error);
        console.error('📊 Détails erreur:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
            currentTeam: currentTeam ? {id: currentTeam.id, name: currentTeam.name} : null
        });
        showNotification('❌ Erreur de chargement. Rechargez la page.', 'error');
    }
}

// Afficher les informations équipe
function showTeamInfo() {
    const teamInfo = document.getElementById('team-info');
    const currentTeamSpan = document.getElementById('current-team');
    
    if (currentTeam && teamInfo && currentTeamSpan) {
        currentTeamSpan.textContent = `Équipe ${currentTeam.name}`;
        currentTeamSpan.style.color = currentTeam.color || '#3498db';
        teamInfo.style.display = 'block';
    }
}

// Afficher une erreur de connexion
function showLoginError(message) {
    const errorDiv = document.getElementById('login-error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    // Vider les champs
    document.getElementById('user-id').value = '';
    document.getElementById('user-password').value = '';
}

// Fonction supprimée - doublon avec la fonction showTeamInfo() ligne 270

async function startGame() {
    // Vérifier si le jeu est déjà démarré
    if (isGameStarted) {
        console.log('⚠️ Jeu déjà démarré, on ignore');
        return;
    }
    
    try {
        console.log('🎮 Démarrage du jeu...');
        
        // Initialiser la carte
        initializeMap();
        console.log('✅ Carte initialisée');
        
        // Demander la géolocalisation
        requestGeolocation();
        console.log('✅ Géolocalisation demandée');
        
        // Configurer les événements
        setupEventListeners();
        console.log('✅ Événements configurés');
        
        // Synchroniser et ajouter les checkpoints depuis Firebase AVANT de continuer
        await syncCheckpoints();
        console.log('✅ Checkpoints synchronisés');
        
        // Mettre à jour l'interface
        updateUI();
        console.log('✅ Interface mise à jour');
        
        isGameStarted = true;
        console.log('🎮 Jeu démarré avec succès');
        
    } catch (error) {
        console.error('❌ Erreur lors du démarrage du jeu:', error);
        console.error('📊 Détails erreur:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        throw error; // Propager l'erreur pour qu'elle soit capturée par loadTeamGameData
    }
}

function initializeMap() {
    console.log('🗺️ Initialisation de la carte...');
    
    // Vérifier si la carte est déjà initialisée
    if (isMapInitialized) {
        console.log('⚠️ Carte déjà initialisée, on ignore');
        return;
    }
    
    // Créer la carte centrée sur Turin
    map = L.map('map').setView(GAME_CONFIG.center, GAME_CONFIG.zoom);
    isMapInitialized = true;
    
    // Ajouter les tuiles CartoDB Voyager (moderne, gratuit, sans clé API)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
    
    // Personnaliser les contrôles
    map.zoomControl.setPosition('bottomright');
    
    // Ajouter le bouton de localisation
    addLocationControl();
    
    console.log('✅ Carte initialisée avec succès');
}

// Ajouter le contrôle de localisation sur la carte
function addLocationControl() {
    // Créer le contrôle personnalisé
    const LocationControl = L.Control.extend({
        options: {
            position: 'bottomright'
        },
        
        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
            
            container.style.backgroundColor = 'white';
            container.style.backgroundImage = 'none';
            container.style.width = '30px';
            container.style.height = '30px';
            container.style.cursor = 'pointer';
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';
            container.style.fontSize = '16px';
            container.style.border = '2px solid rgba(0,0,0,0.2)';
            container.innerHTML = '📍';
            container.title = 'Me localiser';
            
            container.onclick = function() {
                // Fermer le menu mobile si ouvert
                const mobileMenu = document.getElementById('mobile-menu');
                if (mobileMenu && mobileMenu.classList.contains('open')) {
                    closeMobileMenu();
                }
                locateUser();
            };
            
            // Empêcher la propagation des événements
            L.DomEvent.disableClickPropagation(container);
            
            return container;
        }
    });
    
    // Ajouter le contrôle à la carte
    map.addControl(new LocationControl());
}

// Fonction pour localiser l'utilisateur
async function locateUser() {
    console.log('🎯 Localisation demandée via bouton carte');
    
    if (!navigator.geolocation) {
        showNotification('Géolocalisation non supportée', 'error');
        return;
    }
    
    // Afficher un indicateur de chargement
    showNotification('📍 Localisation en cours...', 'info');
    
    try {
        const position = await requestGeolocationBrowser();
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        // Centrer la carte sur la position
        map.setView([lat, lng], 16);
        
        // Mettre à jour la position utilisateur
        userPosition = {
            lat: lat,
            lng: lng,
            accuracy: position.coords.accuracy
        };
        
        updateUserMarker();
        checkProximityToCheckpoints();
        
        showNotification('📍 Position trouvée !', 'success');
        console.log('✅ Localisation réussie:', lat, lng);
    } catch (error) {
        logError(error, 'Manual Location Request', false);
        
        let message = 'Erreur de localisation';
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message = 'Géolocalisation refusée';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'Position indisponible';
                break;
            case error.TIMEOUT:
                message = 'Délai dépassé';
                break;
        }
        
        showNotification(message, 'error');
    }
}

async function requestGeolocation() {
    console.log('📍 Demande de géolocalisation...');
    performanceMetrics.geolocationAttempts++;
    
    if (!navigator.geolocation) {
        logError('Géolocalisation non supportée', 'Geolocation Check', true);
        showNotification('Géolocalisation non supportée par votre navigateur', 'error');
        updateStatus('Géolocalisation non disponible');
        return;
    }
    
    updateStatus('Localisation en cours...');
    
    try {
        const position = await requestGeolocationBrowser();
        onLocationSuccess(position);
    } catch (error) {
        onLocationError(error);
    }
    
    // Surveiller la position en continu
    const watchOptions = {
        enableHighAccuracy: true,
        timeout: BROWSER_INFO.isSafari || BROWSER_INFO.isIOS ? 15000 : 10000,
        maximumAge: BROWSER_INFO.isMobile ? 60000 : 300000
    };
    
    // Stocker l'ID du watch pour pouvoir le pauser/reprendre
    gpsWatchId = navigator.geolocation.watchPosition(
        onLocationUpdate,
        onLocationError,
        watchOptions
    );
    
    console.log('📍 GPS watch démarré (ID:', gpsWatchId, ')');
}


function onLocationSuccess(position) {
    console.log('✅ Position obtenue:', position.coords);
    
    // ✅ VALIDATION GPS AVANT TOUTE OPÉRATION
    const validation = validateGPSPosition(position);
    
    if (!validation.isValid) {
        // Position GPS suspecte
        gpsLockState.consecutiveBadReadings++;
        
        console.warn(`⚠️ Position GPS initiale rejetée (${gpsLockState.consecutiveBadReadings}/${GPS_SAFETY_THRESHOLDS.badReadingsToLock}):`, validation.reason);
        
        // Verrouiller si trop de lectures mauvaises
        if (gpsLockState.consecutiveBadReadings >= GPS_SAFETY_THRESHOLDS.badReadingsToLock) {
            lockGPS(validation.reason);
        }
        
        return; // ❌ Ne pas mettre à jour la position
    }
    
    // Position valide
    gpsLockState.consecutiveBadReadings = 0;
    gpsLockState.stableReadings++;
    
    // Sauvegarder cette position comme dernière position valide
    gpsLockState.lastPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
    };
    gpsLockState.lastPositionTime = Date.now();
    
    // N'afficher la notification que la première fois
    const isFirstPosition = !hasEverGotPosition;
    
    // Marquer qu'on a réussi à obtenir une position et réinitialiser les erreurs
    hasEverGotPosition = true;
    geolocationErrorCount = 0;
    
    userPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy
    };
    
    updateUserMarker();
    updateStatus('Position trouvée !');
    checkProximityToCheckpoints();
    updateHint();
    
    if (isFirstPosition) {
        showNotification('Position détectée avec succès !');
    }
}

function getNextAccessibleCheckpoint() {
    return GAME_CONFIG.checkpoints.find(cp => {
        const isFound = foundCheckpoints.includes(cp.id);
        const isUnlocked = unlockedCheckpoints.includes(cp.id);
        const isAccessible = !cp.locked || isUnlocked;
        return !isFound && isAccessible;
    });
}

function getNextCheckpointForTeam() {
    if (!currentTeam || !currentTeam.route) return null;
    
    const teamRoute = currentTeam.route;
    const nonLobbyFound = foundCheckpoints.filter(id => {
        const cp = GAME_CONFIG.checkpoints.find(c => c.id === id);
        return cp && !cp.isLobby;
    });
    
    // Déterminer quel est le prochain checkpoint dans l'ordre de l'équipe
    // On commence à l'index 1 pour ignorer le lobby (index 0)
    const nextIndex = nonLobbyFound.length + 1;
    
    if (nextIndex < teamRoute.length) {
        return teamRoute[nextIndex];
    }
    
    return null; // Tous les checkpoints sont terminés
}

function getTeamColor() {
    return currentTeam?.color || '#3498db';
}

// Fonction pour mettre à jour la progression sur la route (grignotage + recalcul auto)
function updateRouteProgress() {
    if (!currentRoute || !userPosition) {
        console.log('⚠️ updateRouteProgress: pas de route ou position', {currentRoute: !!currentRoute, userPosition: !!userPosition});
        return;
    }
    
    console.log('🔄 Mise à jour progression GPS...');
    
    const userLatLng = L.latLng(userPosition.lat, userPosition.lng);
    const progressThreshold = 20; // Distance en mètres pour considérer qu'on a "mangé" un segment
    const recalculateThreshold = 50; // Distance en mètres pour recalculer la route
    
    // Récupérer les coordonnées de la route
    const routeCoords = [];
    currentRoute.eachLayer(function(layer) {
        if (layer.feature && layer.feature.geometry && layer.feature.geometry.coordinates) {
            layer.feature.geometry.coordinates.forEach(coord => {
                routeCoords.push(L.latLng(coord[1], coord[0])); // Inverser lng/lat
            });
        }
    });
    
    if (routeCoords.length === 0) return;
    
    // Trouver le point le plus proche sur la route
    let closestDistance = Infinity;
    let closestIndex = 0;
    
    routeCoords.forEach((coord, index) => {
        const distance = userLatLng.distanceTo(coord);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
        }
    });
    
    // Si on est assez proche, "manger" la partie de route déjà parcourue
    if (closestDistance < progressThreshold && closestIndex > 0) {
        const remainingCoords = routeCoords.slice(closestIndex);
        
        if (remainingCoords.length > 1) {
            // Supprimer l'ancienne route
            map.removeLayer(currentRoute);
            
            // Créer une nouvelle route avec seulement la partie restante
            const remainingGeoJSON = {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: remainingCoords.map(coord => [coord.lng, coord.lat])
                }
            };
            
            currentRoute = L.geoJSON(remainingGeoJSON, {
                style: {
                    color: getTeamColor(),
                    weight: 5,
                    opacity: 0.8,
                    dashArray: '10, 5'
                }
            }).addTo(map);
        }
    }
    // Si on est trop loin du trajet, recalculer automatiquement
    else if (closestDistance > recalculateThreshold && currentDestination) {
        const now = Date.now();
        const minRecalculateInterval = 10000; // Minimum 10 secondes entre recalculs
        
        if (now - lastRecalculateTime > minRecalculateInterval) {
            console.log(`🔄 Recalcul automatique - Distance du trajet: ${Math.round(closestDistance)}m`);
            showNotification('🔄 Recalcul du trajet GPS...');
            lastRecalculateTime = now;
            
            // Recalculer la route vers la même destination
            setTimeout(() => {
                calculateRoute(userPosition, currentDestination);
            }, 1000);
        }
    }
}

function onLocationUpdate(position) {
    // ✅ VALIDATION GPS AVANT TOUTE OPÉRATION
    const validation = validateGPSPosition(position);
    
    if (!validation.isValid) {
        // Position GPS suspecte
        gpsLockState.consecutiveBadReadings++;
        
        console.warn(`⚠️ Position GPS rejetée (${gpsLockState.consecutiveBadReadings}/${GPS_SAFETY_THRESHOLDS.badReadingsToLock}):`, validation.reason);
        
        // Verrouiller si trop de lectures mauvaises
        if (gpsLockState.consecutiveBadReadings >= GPS_SAFETY_THRESHOLDS.badReadingsToLock) {
            lockGPS(validation.reason);
        }
        
        return; // ❌ Ne pas mettre à jour la position
    }
    
    // Position valide
    gpsLockState.consecutiveBadReadings = 0;
    gpsLockState.stableReadings++;
    
    // Déverrouiller si assez de lectures stables et si verrouillé
    if (gpsLockState.isLocked && gpsLockState.stableReadings >= GPS_SAFETY_THRESHOLDS.stableReadingsToUnlock) {
        unlockGPS();
    }
    
    // Sauvegarder cette position comme dernière position valide
    gpsLockState.lastPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
    };
    gpsLockState.lastPositionTime = Date.now();
    
    // ✅ Si déverrouillé, mettre à jour normalement
    if (!gpsLockState.isLocked) {
        userPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
        };
        
        updateUserMarker();
        checkProximityToCheckpoints();
        
        // Mettre à jour la route si elle existe (grignotage)
        if (currentRoute) {
            updateRouteProgress();
        }
    }
}

function onLocationError(error) {
    // Incrémenter le compteur d'erreurs
    geolocationErrorCount++;
    
    // Log détaillé de l'erreur de géolocalisation
    console.error('❌ Erreur géolocalisation détaillée:', {
        code: error.code,
        message: error.message,
        errorCount: geolocationErrorCount,
        hasEverGotPosition: hasEverGotPosition,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        permissions: 'unknown'
    });
    
    logError(error, 'Geolocation Error', true);
    
    let message = 'Erreur de géolocalisation';
    let showFallback = false;
    
    switch(error.code) {
        case error.PERMISSION_DENIED:
            message = 'Géolocalisation refusée. Vous pouvez continuer en mode manuel.';
            showFallback = true;
            break;
        case error.POSITION_UNAVAILABLE:
            // Si on a déjà eu une position ou si c'est juste le début (< 3 erreurs), ne pas paniquer
            if (hasEverGotPosition) {
                console.log('⚠️ Position temporairement indisponible (signal GPS perdu), continuez à bouger...');
                message = 'Signal GPS perdu, recherche en cours...';
                showFallback = false;
            } else if (geolocationErrorCount < 3) {
                console.log(`⏳ Erreur ${geolocationErrorCount}/3 - Recherche GPS en cours...`);
                message = 'Recherche de votre position GPS...';
                showFallback = false;
            } else {
                message = 'Position indisponible après plusieurs tentatives. Mode manuel disponible.';
                showFallback = true;
            }
            break;
        case error.TIMEOUT:
            message = 'Délai de géolocalisation dépassé. Réessai automatique...';
            // Réessayer après 5 secondes
            setTimeout(() => {
                console.log('🔄 Nouvel essai de géolocalisation...');
                requestGeolocation();
            }, 5000);
            break;
    }
    
    updateStatus(message);
    
    // N'afficher la notification que si c'est critique ou après plusieurs échecs
    if (error.code === error.PERMISSION_DENIED || (error.code === error.POSITION_UNAVAILABLE && geolocationErrorCount >= 3 && !hasEverGotPosition)) {
        showNotification(message, 'error');
    }
    
    // Afficher le mode fallback si nécessaire
    if (showFallback) {
        showGeolocationFallback();
    }
}

// Mode fallback pour la géolocalisation
function showGeolocationFallback() {
    const fallbackHTML = `
        <div id="geolocation-fallback" style="
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000; max-width: 90%; text-align: center;
        ">
            <h3>🗺️ Mode Manuel</h3>
            <p>La géolocalisation n'est pas disponible.<br>Vous pouvez continuer en mode manuel :</p>
            
            <div style="margin: 1rem 0;">
                <button onclick="simulatePosition(49.0928, 6.1907)" style="
                    background: #3498db; color: white; border: none; padding: 0.8rem 1rem;
                    border-radius: 8px; margin: 0.5rem; cursor: pointer;
                ">📍 Position Luxembourg Centre</button>
                
                <button onclick="simulatePosition(49.6116, 6.1319)" style="
                    background: #27ae60; color: white; border: none; padding: 0.8rem 1rem;
                    border-radius: 8px; margin: 0.5rem; cursor: pointer;
                ">📍 Position Luxembourg Ville</button>
            </div>
            
            <div style="margin: 1rem 0;">
                <input type="number" id="manual-lat" placeholder="Latitude" step="any" style="
                    padding: 0.5rem; margin: 0.2rem; border: 1px solid #ddd; border-radius: 4px; width: 120px;
                ">
                <input type="number" id="manual-lng" placeholder="Longitude" step="any" style="
                    padding: 0.5rem; margin: 0.2rem; border: 1px solid #ddd; border-radius: 4px; width: 120px;
                ">
                <button onclick="setManualPosition()" style="
                    background: #f39c12; color: white; border: none; padding: 0.5rem 1rem;
                    border-radius: 4px; margin: 0.2rem; cursor: pointer;
                ">✅ Valider</button>
            </div>
            
            <button onclick="closeGeolocationFallback()" style="
                background: #e74c3c; color: white; border: none; padding: 0.5rem 1rem;
                border-radius: 4px; cursor: pointer;
            ">❌ Fermer</button>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', fallbackHTML);
}

function setManualPosition() {
    const lat = parseFloat(document.getElementById('manual-lat').value);
    const lng = parseFloat(document.getElementById('manual-lng').value);
    
    if (isNaN(lat) || isNaN(lng)) {
        showNotification('Coordonnées invalides', 'error');
        return;
    }
    
    // Simuler une position
    simulatePosition(lat, lng);
    closeGeolocationFallback();
}

function closeGeolocationFallback() {
    const fallback = document.getElementById('geolocation-fallback');
    if (fallback) {
        fallback.remove();
    }
}

function updateUserMarker() {
    if (!userPosition) return;
    
    const userLatLng = [userPosition.lat, userPosition.lng];
    
    if (userMarker) {
        // Si le marqueur existe, mettre à jour sa position
        userMarker.setLatLng(userLatLng);
        // Mettre à jour le cercle de précision si on a l'accuracy
        if (userPosition.accuracy && userMarker.accuracyCircle) {
            userMarker.accuracyCircle.setLatLng(userLatLng);
            userMarker.accuracyCircle.setRadius(userPosition.accuracy);
        }
    } else {
        // Créer un cercle bleu pour la position (pas d'épingle)
        userMarker = L.circleMarker(userLatLng, {
            radius: 8,
            fillColor: '#4285F4',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(map);
        
        // Ajouter le cercle de précision GPS
        if (userPosition.accuracy) {
            userMarker.accuracyCircle = L.circle(userLatLng, {
                radius: userPosition.accuracy,
                color: '#4285F4',
                fillColor: '#4285F4',
                fillOpacity: 0.1,
                weight: 1
            }).addTo(map);
        }
    }
    
    // Centrer la carte sur l'utilisateur (seulement la première fois)
    if (!map.hasUserCentered) {
        map.setView(userLatLng, GAME_CONFIG.zoom);
        map.hasUserCentered = true;
    }
}

function addCheckpointsToMap() {
    console.log('📍 Ajout des checkpoints sur la carte...');
    
    GAME_CONFIG.checkpoints.forEach(checkpoint => {
        // ✅ FILTRER : Ne montrer QUE les checkpoints de la route de l'équipe
        if (currentTeam && currentTeam.route && !currentTeam.route.includes(checkpoint.id)) {
            console.log(`🚫 Checkpoint ${checkpoint.name} (${checkpoint.id}) ignoré à l'affichage: pas dans la route`);
            return; // Skip ce checkpoint
        }
        
        const isFound = foundCheckpoints.includes(checkpoint.id);
        const isUnlocked = unlockedCheckpoints.includes(checkpoint.id);
        const isLocked = checkpoint.locked && !isUnlocked;
        
        // Ne pas afficher les points verrouillés sur la carte
        if (isLocked) {
            // Stocker le checkpoint pour l'ajouter plus tard
            checkpointMarkers.push({
                id: checkpoint.id,
                marker: null,
                circle: null,
                checkpoint: checkpoint,
                hidden: true
            });
            return;
        }
        
        // Ajouter le cercle de proximité (buffer de 50m)
        const circle = L.circle(checkpoint.coordinates, {
            color: isFound ? '#27ae60' : '#3498db',
            fillColor: isFound ? '#27ae60' : '#3498db',
            fillOpacity: 0.1,
            radius: GAME_CONFIG.proximityThreshold,
            weight: 2,
            opacity: 0.6
        }).addTo(map);
        
        let markerClass = 'checkpoint-marker';
        if (isFound) markerClass += ' found';
        
        const markerIcon = L.divIcon({
            className: markerClass,
            html: checkpoint.emoji,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        
        // Créer une fonction pour générer le contenu du popup (dynamique)
        const generatePopupContent = () => {
            const currentlyFound = foundCheckpoints.includes(checkpoint.id);
            let buttonText = checkpoint.isLobby ? '🧭 GPS vers Lobby' : '🧭 Calculer l\'itinéraire GPS';
            
            return `
                <div>
                    <h3>${checkpoint.emoji} ${checkpoint.name}</h3>
                    <p>${currentlyFound ? '✅ Découvert !' : checkpoint.isLobby ? '🏠 Lobby' : '🔍 À découvrir'}</p>
                    ${!currentlyFound ? `<p><em>${checkpoint.hint}</em></p>` : ''}
                    <p><small>Zone de déclenchement: ${GAME_CONFIG.proximityThreshold}m</small></p>
                    <button onclick="calculateRouteFromPopup(${checkpoint.id})">
                        ${buttonText}
                    </button>
                </div>
            `;
        };
        
        const marker = L.marker(checkpoint.coordinates, { icon: markerIcon })
            .addTo(map)
            .bindPopup(generatePopupContent());
        
        // Mettre à jour le popup quand il s'ouvre (pour afficher les infos à jour)
        marker.on('popupopen', function() {
            this.setPopupContent(generatePopupContent());
        });
        
        // Ajouter un événement de clic pour rouvrir les épreuves si elles ont été fermées manuellement
        marker.on('click', function() {
            // Si le checkpoint est dans dismissedModals, le retirer pour permettre la réouverture
            if (dismissedModals.has(checkpoint.id)) {
                console.log(`🔓 Clic sur marker: ${checkpoint.name} retiré de dismissedModals`);
            }
        });
        
        checkpointMarkers.push({
            id: checkpoint.id,
            marker: marker,
            circle: circle,
            checkpoint: checkpoint,
            hidden: false
        });
    });
    
    console.log(`✅ ${checkpointMarkers.filter(m => !m.hidden).length} checkpoints visibles ajoutés`);
}

function checkProximityToCheckpoints() {
    if (!userPosition) return;
    
    const now = Date.now();
    checkpointsInRange.clear(); // Réinitialiser la liste des checkpoints dans la zone
    
    // Vérifier seulement les checkpoints visibles sur la carte
    checkpointMarkers.forEach(markerData => {
        if (markerData.hidden || !markerData.marker) return;
        if (foundCheckpoints.includes(markerData.checkpoint.id)) return;
        
        const checkpoint = markerData.checkpoint;
        const checkpointId = checkpoint.id;
        
        // ✅ VÉRIFIER QUE LE CHECKPOINT FAIT PARTIE DE LA ROUTE DE L'ÉQUIPE
        if (currentTeam && currentTeam.route && !currentTeam.route.includes(checkpointId)) {
            console.log(`🚫 Checkpoint ${checkpoint.name} (${checkpointId}) ignoré: pas dans la route de l'équipe`, {
                checkpointId,
                teamRoute: currentTeam.route
            });
            return; // Ce checkpoint n'est pas dans la route de cette équipe
        }
        
        // Calculer la distance
        const distance = calculateDistance(
            userPosition.lat,
            userPosition.lng,
            checkpoint.coordinates[0],
            checkpoint.coordinates[1]
        );
        
        // Si le checkpoint est dans la zone, l'ajouter au Set
        if (distance <= GAME_CONFIG.proximityThreshold) {
            checkpointsInRange.add(checkpointId);
            
            // ✅ VÉRIFIER SI LA NOTIFICATION DE DÉCOUVERTE A DÉJÀ ÉTÉ AFFICHÉE
            // Ceci évite les logs en boucle pour les checkpoints photo/audio qui ne sont pas ajoutés immédiatement à foundCheckpoints
            if (discoveredCheckpoints.has(checkpointId)) {
                return; // Notification déjà affichée pour ce checkpoint, on ne re-déclenche pas
            }
            
            // Protection anti-spam : vérifier le cooldown
            const lastTrigger = lastCheckpointTrigger[checkpointId] || 0;
            if (now - lastTrigger < modalCooldown) {
                return; // Trop tôt pour re-déclencher ce checkpoint
            }
            
            console.log(`🎯 Checkpoint ${checkpoint.name} trouvé ! Distance: ${distance.toFixed(1)}m`);
            
            // Marquer comme découvert pour ne plus afficher la notification
            discoveredCheckpoints.add(checkpointId);
            
            // Marquer le timestamp pour éviter les re-déclenchements
            lastCheckpointTrigger[checkpointId] = now;
            
            // Validation anti-triche basique
            validateCheckpointProximity(checkpoint, distance);
        }
    });
    
    // Note: dismissedModals n'est PAS nettoyé automatiquement quand on sort de la zone
    // L'utilisateur doit cliquer manuellement sur "Tenter l'épreuve" dans le popup du checkpoint
}

// Validation serveur de la proximité (anti-triche basique)
async function validateCheckpointProximity(checkpoint, distance) {
    // ===== ANCIEN: GPS Lock check désactivé =====
    // Plus de blocage par GPS lock pour les validations
    // Le GPS Lock reste actif pour la détection de position mais ne bloque plus les actions
    
    const validationData = {
        checkpointId: checkpoint.id,
        teamId: currentTeamId,
        userPosition: userPosition,
        distance: distance,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
        accuracy: userPosition.accuracy || 0
    };
    
    try {
        // Log de la tentative de validation
        console.log('🔍 Validation proximité:', validationData);
        
        // Vérifications anti-triche basiques
        const suspiciousActivity = detectSuspiciousActivity(validationData);
        if (suspiciousActivity) {
            logError(`Activité suspecte détectée: ${suspiciousActivity}`, 'Anti-Cheat', true);
            showNotification('⚠️ Activité suspecte détectée', 'warning');
            return;
        }
        
        // Si tout est OK, marquer comme trouvé
        foundCheckpoint(checkpoint);
        
        // Optionnel: Envoyer à Firebase pour audit
        if (firebaseService) {
            await safeApiCall(
                () => firebaseService.logCheckpointValidation?.(validationData),
                'Checkpoint Validation Log'
            );
        }
        
    } catch (error) {
        logError(error, 'Checkpoint Validation', true);
    }
}

// Détection d'activité suspecte basique
function detectSuspiciousActivity(data) {
    // Vérifier d'abord si le GPS est verrouillé
    if (gpsLockState.isLocked) {
        return `GPS verrouillé: ${gpsLockState.lockReason}`;
    }
    
    // Vérifier la précision GPS
    if (data.accuracy > 100) {
        return 'Précision GPS trop faible';
    }
    
    // Vérifier les mouvements impossibles
    const lastValidation = performanceMetrics.lastValidation;
    if (lastValidation) {
        const timeDiff = data.timestamp - lastValidation.timestamp;
        const distanceDiff = calculateDistance(
            data.userPosition.lat, data.userPosition.lng,
            lastValidation.userPosition.lat, lastValidation.userPosition.lng
        );
        
        // Vitesse impossible (>200 km/h)
        const speed = (distanceDiff / 1000) / (timeDiff / 3600000); // km/h
        if (speed > 200) {
            return `Vitesse impossible: ${speed.toFixed(1)} km/h`;
        }
    }
    
    performanceMetrics.lastValidation = data;
    return null;
}

// ===== SYSTÈME DE VALIDATION ET VERROUILLAGE GPS =====

/**
 * Valide une position GPS et détermine si elle doit être acceptée ou rejetée
 * @param {Object} position - Position GPS avec coords.latitude, coords.longitude, coords.accuracy
 * @returns {Object} { isValid: boolean, reason: string|null }
 */
function validateGPSPosition(position) {
    const now = Date.now();
    const accuracy = position.coords.accuracy;
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    
    // 1. Vérifier la précision GPS
    if (accuracy > GPS_SAFETY_THRESHOLDS.maxAccuracy) {
        return {
            isValid: false,
            reason: `Précision GPS insuffisante (${Math.round(accuracy)}m > ${GPS_SAFETY_THRESHOLDS.maxAccuracy}m)`
        };
    }
    
    // 2. Vérifier les sauts de position (téléportation)
    if (gpsLockState.lastPosition && gpsLockState.lastPositionTime) {
        const timeDiff = now - gpsLockState.lastPositionTime;
        
        // Seulement si assez de temps s'est écoulé
        if (timeDiff >= GPS_SAFETY_THRESHOLDS.minTimeBetweenJumps) {
            const distance = calculateDistance(
                lat, lng,
                gpsLockState.lastPosition.lat,
                gpsLockState.lastPosition.lng
            );
            
            // Calculer la vitesse
            const speed = (distance / 1000) / (timeDiff / 3600000); // km/h
            
            // Vérifier si la vitesse est impossible
            if (speed > GPS_SAFETY_THRESHOLDS.maxSpeed) {
                return {
                    isValid: false,
                    reason: `Vitesse impossible détectée (${Math.round(speed)} km/h)`
                };
            }
            
            // Vérifier si le saut de distance est trop important
            if (distance > GPS_SAFETY_THRESHOLDS.maxJumpDistance) {
                return {
                    isValid: false,
                    reason: `Saut de position suspect (${Math.round(distance)}m en ${Math.round(timeDiff/1000)}s)`
                };
            }
        }
    }
    
    // Position valide
    return { isValid: true, reason: null };
}

/**
 * Verrouille le GPS et bloque toutes les opérations
 */
function lockGPS(reason) {
    if (!gpsLockState.isLocked) {
        gpsLockState.isLocked = true;
        gpsLockState.lockReason = reason;
        gpsLockState.stableReadings = 0;
        
        console.error(`🔒 GPS VERROUILLÉ: ${reason}`);
        showNotification('⚠️ GPS instable détecté - Opérations suspendues', 'warning');
        updateStatus(`GPS verrouillé: ${reason}`);
        
        // Ajouter une indication visuelle
        if (userMarker) {
            userMarker.setOpacity(0.3); // Rendre le marqueur semi-transparent
        }
        
        logError(`GPS verrouillé: ${reason}`, 'GPS Lock System', true);
    }
}

/**
 * Déverrouille le GPS si les conditions sont remplies
 */
function unlockGPS() {
    if (gpsLockState.isLocked) {
        gpsLockState.isLocked = false;
        gpsLockState.lockReason = null;
        gpsLockState.consecutiveBadReadings = 0;
        
        console.log(`🔓 GPS DÉVERROUILLÉ - Signal stable retrouvé`);
        showNotification('✅ GPS stabilisé - Opérations reprises', 'success');
        updateStatus('Position trouvée !');
        
        // Restaurer l'opacité normale du marqueur
        if (userMarker) {
            userMarker.setOpacity(1.0);
        }
    }
}

/**
 * Vérifie si une opération GPS peut être effectuée
 * @returns {boolean} true si l'opération est autorisée
 */
function isGPSOperationAllowed() {
    if (gpsLockState.isLocked) {
        console.warn('⚠️ Opération bloquée: GPS verrouillé -', gpsLockState.lockReason);
        return false;
    }
    return true;
}

function foundCheckpoint(checkpoint) {
    if (foundCheckpoints.includes(checkpoint.id)) return;
    
    // Pour les checkpoints photo, audio, QCM et énigmes, ne pas marquer comme trouvé immédiatement
    // Photo : attendre la validation admin
    // Audio : attendre la réussite de l'épreuve
    // QCM : attendre la bonne réponse
    // Énigme (riddle) : attendre la bonne réponse
    // Instruction : attendre le clic sur "J'ai compris"
    const hasRiddle = checkpoint.clue?.riddle || checkpoint.clue?.enigma || checkpoint.clue?.puzzle;
    if (checkpoint.type !== 'photo' && checkpoint.type !== 'audio' && checkpoint.type !== 'qcm' && checkpoint.type !== 'instruction' && !hasRiddle) {
        foundCheckpoints.push(checkpoint.id);
    }
    
    // Supprimer la route actuelle puisque le point est atteint
    if (currentRoute) {
        map.removeLayer(currentRoute);
        currentRoute = null;
    }
    
    // Mettre à jour le marqueur et le cercle (sauf pour les épreuves audio, QCM et énigmes non réussies)
    const markerData = checkpointMarkers.find(m => m.id === checkpoint.id);
    const hasRiddleCheck = checkpoint.clue?.riddle || checkpoint.clue?.enigma || checkpoint.clue?.puzzle;
    if (markerData && checkpoint.type !== 'audio' && checkpoint.type !== 'qcm' && checkpoint.type !== 'instruction' && !hasRiddleCheck) {
        const newIcon = L.divIcon({
            className: 'checkpoint-marker found',
            html: checkpoint.emoji,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        markerData.marker.setIcon(newIcon);
        
        // Contenu du popup différent pour le lobby
        let popupContent;
        if (checkpoint.isLobby) {
            popupContent = `
                <div>
                    <h3>${checkpoint.emoji} ${checkpoint.name}</h3>
                    <p>✅ Visité !</p>
                    <p><em>${checkpoint.hint}</em></p>
                    <p><small>Zone de déclenchement: ${GAME_CONFIG.proximityThreshold}m</small></p>
                    <button onclick="calculateRouteFromPopup(0)">
                        🧭 GPS vers Lobby
                    </button>
                </div>
            `;
        } else {
            popupContent = `
                <div>
                    <h3>${checkpoint.emoji} ${checkpoint.name}</h3>
                    <p>✅ Découvert !</p>
                    <p><small>Zone de déclenchement: ${GAME_CONFIG.proximityThreshold}m</small></p>
                    <button onclick="calculateRouteFromPopup(${checkpoint.id})">
                        🧭 Calculer l'itinéraire GPS
                    </button>
                </div>
            `;
        }
        
        markerData.marker.setPopupContent(popupContent);
        
        // Mettre à jour le cercle en vert (sauf pour les épreuves audio, QCM, instructions et énigmes non réussies)
        if (checkpoint.type !== 'audio' && checkpoint.type !== 'qcm' && checkpoint.type !== 'instruction' && !hasRiddleCheck) {
            markerData.circle.setStyle({
                color: '#27ae60',
                fillColor: '#27ae60'
            });
        }
    }
    
    // Afficher l'indice (sauf pour le lobby et sauf si c'est la fin du jeu)
    if (!checkpoint.isLobby) {
        // Vérifier si c'est le dernier checkpoint
        const teamRoute = currentTeam?.route || [];
        const nonLobbyRoute = teamRoute.filter(id => id !== 0);
        const nonLobbyFound = foundCheckpoints.filter(id => id !== 0);
        const isGameComplete = nonLobbyFound.length >= nonLobbyRoute.length && nonLobbyRoute.length > 0;
        
        if (!isGameComplete) {
            showClue(checkpoint.clue, checkpoint);
        } else {
            console.log('🏁 Dernier checkpoint - pas d\'indice, seulement modal de victoire');
        }
    } else {
        // Pour le lobby, débloquer le premier checkpoint selon l'équipe
        setTimeout(() => {
            console.log('🏠 Lobby trouvé, recherche du premier checkpoint...');
            console.log('👥 currentTeam:', currentTeam);
            console.log('🛤️ teamRoute:', currentTeam?.route);
            
            const firstCheckpointId = getNextCheckpointForTeam();
            console.log('🎯 Premier checkpoint ID:', firstCheckpointId);
            
            if (firstCheckpointId) {
                console.log('🔓 Débloquage du checkpoint:', firstCheckpointId);
                unlockCheckpoint(firstCheckpointId);
            } else {
                console.log('❌ Aucun checkpoint à débloquer trouvé');
            }
        }, 1000);
    }
    
    // ===== SAUVEGARDE IMMÉDIATE pour checkpoint trouvé =====
    // L'auto-save gère déjà les sauvegardes périodiques, mais on sauve immédiatement 
    // quand un checkpoint est trouvé pour avoir une réactivité maximale
    const hasRiddleSave = checkpoint.clue?.riddle || checkpoint.clue?.enigma || checkpoint.clue?.puzzle;
    if (firebaseService && currentTeam && currentTeamId && checkpoint.type !== 'audio' && checkpoint.type !== 'qcm' && checkpoint.type !== 'photo' && checkpoint.type !== 'instruction' && !hasRiddleSave) {
        // ===== ANCIEN: GPS Lock check désactivé =====
        // Plus de blocage par GPS lock, l'auto-save gère tout
        // Plus besoin d'utilisateurs - équipe directement
        
        // Mettre à jour l'équipe aussi pour que l'admin voit les changements
        firebaseService.updateTeamProgress(currentTeamId, {
            foundCheckpoints: foundCheckpoints,
            unlockedCheckpoints: unlockedCheckpoints
        });
        
        console.log('💾 Progression sauvegardée immédiatement (checkpoint trouvé):', {
            teamId: currentTeamId,
            foundCheckpoints, 
            unlockedCheckpoints
        });
        
        // Sauvegarder aussi dans le système hybride pour cohérence
        forceSave('checkpoint_found');
    } else if (checkpoint.type === 'photo') {
        console.log('📸 Checkpoint photo - validation automatique dans 30s');
        // Auto-validation après 30 secondes pour éviter le blocage
        setTimeout(() => {
            // ===== ANCIEN: GPS Lock check désactivé =====
            if (firebaseService && currentTeam && currentTeamId) {
                firebaseService.updateTeamProgress(currentTeamId, {
                    foundCheckpoints: foundCheckpoints,
                    unlockedCheckpoints: unlockedCheckpoints
                });
                console.log('📸 Auto-validation photo après timeout');
                forceSave('photo_timeout');
            }
        }, 30000);
    } else if (checkpoint.type === 'audio') {
        console.log('🎤 Checkpoint audio - attente réussite épreuve');
    } else if (checkpoint.type === 'qcm') {
        console.log('📋 Checkpoint QCM - attente bonne réponse');
    } else if (checkpoint.type === 'instruction') {
        console.log('📄 Checkpoint instruction - attente validation "J\'ai compris"');
    } else if (hasRiddleSave) {
        console.log('🧩 Checkpoint énigme - attente bonne réponse');
    }
    
    // Mettre à jour l'interface
    updateUI();
    
    // Vérifier si l'équipe a terminé son parcours (exclure le lobby du compte)
    const teamRoute = currentTeam?.route || [];
    const nonLobbyRoute = teamRoute.filter(id => id !== 0); // Exclure le lobby
    const nonLobbyFound = foundCheckpoints.filter(id => id !== 0); // Exclure le lobby
    
    console.log('🏁 Vérification fin de jeu:', {
        teamRoute: teamRoute,
        nonLobbyRoute: nonLobbyRoute,
        nonLobbyFound: nonLobbyFound,
        isComplete: nonLobbyFound.length >= nonLobbyRoute.length
    });
    
    const isGameComplete = nonLobbyFound.length >= nonLobbyRoute.length && nonLobbyRoute.length > 0;
    
    if (isGameComplete) {
        console.log(`🎉 Équipe ${currentTeam?.name} a terminé son parcours !`);
        // Pour le dernier checkpoint, afficher seulement le modal de victoire
        setTimeout(() => {
            showSuccessModal();
        }, 1000);
    } else {
        // Notification normale seulement si ce n'est pas la fin
        const message = checkpoint.isLobby ? `🏠 Bienvenue au ${checkpoint.name} !` : `🎉 ${checkpoint.name} découvert !`;
        showNotification(message);
    }
}

function showClue(clue, checkpoint = null) {
    // Protection anti-spam : vérifier si un modal est déjà ouvert pour ce checkpoint
    if (checkpoint && activeModals.has(checkpoint.id)) {
        console.log(`🚫 Modal déjà ouvert pour ${checkpoint.name}, ignoré`);
        return;
    }
    
    // Si c'est un checkpoint photo, afficher le modal photo
    if (checkpoint && checkpoint.type === 'photo') {
        // Vérifier si le modal photo est déjà ouvert
        const photoModal = document.getElementById('photo-modal');
        if (photoModal && photoModal.style.display === 'flex') {
            console.log(`🚫 Modal photo déjà ouvert pour ${checkpoint.name}, ignoré`);
            return;
        }
        showPhotoChallenge(checkpoint);
        return;
    }
    
    // Si c'est un checkpoint audio, afficher le modal audio
    if (checkpoint && checkpoint.type === 'audio') {
        // Vérifier si le modal audio est déjà ouvert
        const audioModal = document.getElementById('audio-modal');
        if (audioModal && audioModal.style.display === 'flex') {
            console.log(`🚫 Modal audio déjà ouvert pour ${checkpoint.name}, ignoré`);
            return;
        }
        showAudioChallenge(checkpoint);
        return;
    }
    
    // Si c'est un checkpoint QCM, afficher le modal QCM
    if (checkpoint && checkpoint.type === 'qcm') {
        // Vérifier si le modal QCM est déjà ouvert
        const qcmModal = document.getElementById('qcm-modal');
        if (qcmModal && qcmModal.style.display === 'flex') {
            console.log(`🚫 Modal QCM déjà ouvert pour ${checkpoint.name}, ignoré`);
            return;
        }
        showQCMChallenge(checkpoint);
        return;
    }
    
    // Si c'est un checkpoint instruction, afficher le modal instructions
    if (checkpoint && checkpoint.type === 'instruction') {
        // Vérifier si le modal instructions est déjà ouvert
        const instructionModal = document.getElementById('instruction-modal');
        if (instructionModal && instructionModal.style.display === 'flex') {
            console.log(`🚫 Modal instructions déjà ouvert pour ${checkpoint.name}, ignoré`);
            return;
        }
        showInstructionChallenge(checkpoint);
        return;
    }
    
    // Si l'indice contient une énigme, afficher la modal d'énigme
    if (clue.riddle) {
        showRiddle(clue, checkpoint);
        return;
    }
    
    // Sinon, afficher la modal d'indice normale
    const modal = document.getElementById('clue-modal');
    const title = document.getElementById('clue-title');
    const text = document.getElementById('clue-text');
    const image = document.getElementById('clue-image');
    
    title.textContent = clue.title;
    text.textContent = clue.text;
    
    if (clue.image) {
        image.innerHTML = `<img src="${clue.image}" alt="${clue.title}">`;
    } else {
        image.innerHTML = '';
    }
    
    modal.style.display = 'block';
}

function showRiddle(clue, checkpoint = null) {
    // Vérifier si le modal a été fermé manuellement
    if (checkpoint && dismissedModals.has(checkpoint.id)) {
        console.log(`🚫 Modal énigme fermé manuellement pour ${checkpoint.name}, ignoré (cliquez sur le marker pour rouvrir)`);
        return;
    }
    
    const modal = document.getElementById('riddle-modal');
    const question = document.getElementById('riddle-question');
    const answerInput = document.getElementById('riddle-answer');
    const hintElement = document.getElementById('riddle-hint');
    const feedback = document.getElementById('riddle-feedback');
    
    // Support des formats d'énigme (nouveau et ancien)
    const riddleConfig = clue.riddle || clue.enigma || clue.puzzle;
    if (!riddleConfig) {
        console.error('❌ Configuration énigme manquante:', clue);
        return;
    }
    
    // Stocker le checkpoint actuel
    currentRiddleCheckpoint = checkpoint;
    
    console.log('🧩 Configuration énigme trouvée:', riddleConfig);
    console.log('🧩 Structure complète de l\'indice:', clue);
    
    question.textContent = riddleConfig.question;
    hintElement.textContent = riddleConfig.hint || riddleConfig.clue || 'Aucun indice disponible';
    hintElement.style.display = 'none';
    answerInput.value = '';
    feedback.innerHTML = '';
    feedback.className = '';
    
    modal.style.display = 'block';
    answerInput.focus();
}

function checkRiddleAnswer() {
    const answerInput = document.getElementById('riddle-answer');
    const hintElement = document.getElementById('riddle-hint');
    const feedback = document.getElementById('riddle-feedback');
    const userAnswer = answerInput.value.trim().toLowerCase();
    
    // Récupérer l'énigme du checkpoint actuel depuis la modal
    const riddleQuestion = document.getElementById('riddle-question').textContent;
    
    // Trouver le checkpoint correspondant à cette énigme
    const currentCheckpoint = GAME_CONFIG.checkpoints.find(cp => {
        const riddleConfig = cp.clue?.riddle || cp.clue?.enigma || cp.clue?.puzzle;
        return riddleConfig && riddleConfig.question === riddleQuestion;
    });
    
    if (!currentCheckpoint || !currentCheckpoint.clue) {
        console.error('❌ Impossible de trouver l\'énigme actuelle');
        feedback.innerHTML = '❌ Erreur système. Veuillez recharger la page.';
        feedback.className = 'error';
        return;
    }
    
    const riddleConfig = currentCheckpoint.clue.riddle || currentCheckpoint.clue.enigma || currentCheckpoint.clue.puzzle;
    if (!riddleConfig) {
        console.error('❌ Configuration énigme manquante pour la vérification');
        feedback.innerHTML = '❌ Configuration énigme invalide.';
        feedback.className = 'error';
        return;
    }
    
    const correctAnswer = riddleConfig.answer.toLowerCase();
    
    if (userAnswer === correctAnswer) {
        // Bonne réponse !
        console.log('🎉 Énigme réussie !');
        
        // Marquer ce checkpoint comme trouvé AVANT de débloquer le suivant
        if (!foundCheckpoints.includes(currentCheckpoint.id)) {
            foundCheckpoints.push(currentCheckpoint.id);
            
            // Mettre à jour le marqueur et le cercle sur la carte
            const markerData = checkpointMarkers.find(m => m.id === currentCheckpoint.id);
            if (markerData) {
                // Mettre à jour l'icône
                if (markerData.marker) {
                    const foundIcon = L.divIcon({
                        className: 'checkpoint-marker found',
                        html: currentCheckpoint.emoji,
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    });
                    markerData.marker.setIcon(foundIcon);
                }
                
                // Mettre à jour le cercle en vert
                if (markerData.circle) {
                    markerData.circle.setStyle({
                        color: '#27ae60',
                        fillColor: '#27ae60'
                    });
                }
            }
            
            // Sauvegarder dans Firebase
            if (firebaseService && currentTeamId) {
                firebaseService.updateTeamProgress(currentTeamId, {
                    foundCheckpoints: foundCheckpoints,
                    updatedAt: new Date()
                }).catch(error => console.error('❌ Erreur sauvegarde énigme:', error));
            }
        }
        
        // Débloquer le prochain point selon l'équipe
        const nextCheckpointId = getNextCheckpointForTeam();
        let feedbackMessage;
        if (nextCheckpointId) {
            unlockCheckpoint(nextCheckpointId);
            const nextCheckpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === nextCheckpointId);
            const nextName = nextCheckpoint ? nextCheckpoint.name : 'prochain point';
            feedbackMessage = `🎉 Correct ! "${nextName}" est maintenant débloqué !`;
        } else {
            feedbackMessage = '🎉 Correct ! Vous avez terminé votre parcours !';
        }
        
        // Afficher le succès avec bouton
        feedback.innerHTML = `
            <div class="success">${feedbackMessage}</div>
            <button id="riddle-continue-btn" style="margin-top: 1rem; padding: 0.8rem 1.5rem; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem;">✅ Continuer l'aventure</button>
        `;
        feedback.className = 'success';
        
        // Masquer les contrôles de réponse
        document.getElementById('riddle-input-container').style.display = 'none';
        
        // Ajouter le listener sur le bouton
        setTimeout(() => {
            const continueBtn = document.getElementById('riddle-continue-btn');
            if (continueBtn) {
                continueBtn.addEventListener('click', () => {
                    console.log('🔘 Clic sur bouton Continuer Énigme');
                    
                    // Fermer le modal
                    document.getElementById('riddle-modal').style.display = 'none';
                    
                    // Marquer comme dismissed
                    if (currentCheckpoint) {
                        dismissedModals.add(currentCheckpoint.id);
                        console.log(`✅ Énigme résolue pour ${currentCheckpoint.name}, modal marqué comme dismissed`);
                    }
                    
                    // Réafficher les contrôles pour la prochaine fois
                    document.getElementById('riddle-input-container').style.display = 'block';
                    
                    // Zoomer sur le nouveau point débloqué et lancer la navigation GPS
                    if (nextCheckpointId) {
                        const unlockedCheckpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === nextCheckpointId);
                        if (unlockedCheckpoint) {
                            console.log('🎯 Zoom vers le checkpoint débloqué:', unlockedCheckpoint.name);
                            centerMapOnCheckpoint(unlockedCheckpoint);
                            
                            // Lancer la navigation GPS automatique
                            if (userPosition) {
                                calculateRoute(userPosition, unlockedCheckpoint);
                                showNotification(`🎯 "${unlockedCheckpoint.name}" débloqué ! Navigation GPS activée.`);
                            } else {
                                showNotification(`🎯 "${unlockedCheckpoint.name}" débloqué ! Suivez la carte.`);
                            }
                        } else {
                            console.warn('⚠️ Checkpoint débloqué non trouvé:', nextCheckpointId);
                            showNotification('🎯 Prochain défi débloqué ! Navigation GPS activée.');
                        }
                    } else {
                        showNotification('🏆 Parcours terminé ! Félicitations !');
                    }
                });
            }
        }, 100);
        
    } else {
        // Mauvaise réponse
        feedback.innerHTML = '❌ Réponse incorrecte. Essayez encore !';
        feedback.className = 'error';
        hintElement.style.display = 'block';
        answerInput.value = '';
        answerInput.focus();
    }
}

function unlockCheckpoint(checkpointId) {
    if (unlockedCheckpoints.includes(checkpointId)) return;
    
    unlockedCheckpoints.push(checkpointId);
    
    // Trouver le checkpoint dans la liste
    const markerData = checkpointMarkers.find(m => m.id === checkpointId);
    if (markerData && markerData.hidden) {
        const checkpoint = markerData.checkpoint;
        
        // RÉVÉLER le point sur la carte (il était caché)
        console.log(`🎭 Révélation du checkpoint ${checkpoint.name} sur la carte`);
        
        // Créer le cercle de proximité
        const circle = L.circle(checkpoint.coordinates, {
            color: '#3498db',
            fillColor: '#3498db',
            fillOpacity: 0.1,
            radius: GAME_CONFIG.proximityThreshold,
            weight: 2,
            opacity: 0.6
        }).addTo(map);
        
        // Créer le marqueur
        const markerIcon = L.divIcon({
            className: 'checkpoint-marker',
            html: checkpoint.emoji,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        
        // Créer une fonction pour générer le contenu du popup (dynamique)
        const generatePopupContent = () => {
            const currentlyFound = foundCheckpoints.includes(checkpoint.id);
            return `
                <div>
                    <h3>${checkpoint.emoji} ${checkpoint.name}</h3>
                    <p>${currentlyFound ? '✅ Découvert !' : '🔍 À découvrir'}</p>
                    ${!currentlyFound ? `<p><em>${checkpoint.hint}</em></p>` : ''}
                    <p><small>Zone de déclenchement: ${GAME_CONFIG.proximityThreshold}m</small></p>
                    <button onclick="calculateRouteFromPopup(${checkpoint.id})">
                        🧭 Calculer l'itinéraire GPS
                    </button>
                </div>
            `;
        };
        
        const marker = L.marker(checkpoint.coordinates, { icon: markerIcon })
            .addTo(map)
            .bindPopup(generatePopupContent());
        
        // Mettre à jour le popup quand il s'ouvre
        marker.on('popupopen', function() {
            this.setPopupContent(generatePopupContent());
        });
        
        // Mettre à jour les données du marqueur
        markerData.marker = marker;
        markerData.circle = circle;
        markerData.hidden = false;
        
        // Centrer la carte sur le nouveau point débloqué
        centerMapOnCheckpoint(checkpoint);
    }
    
    // Sauvegarder la progression dans Firebase (équipe seulement)
    if (firebaseService && currentTeam && currentTeamId) {
        // Plus besoin d'utilisateurs - équipe directement
        
        // Mettre à jour l'équipe aussi pour que l'admin voit les changements
        firebaseService.updateTeamProgress(currentTeamId, {
            foundCheckpoints: foundCheckpoints,
            unlockedCheckpoints: unlockedCheckpoints
        });
        
        console.log('💾 Progression sauvegardée (utilisateur + équipe):', {
            teamId: currentTeamId,
            teamId: currentTeamId,
            foundCheckpoints, 
            unlockedCheckpoints
        });
    }
    
    updateHint();
    console.log(`🔓 Checkpoint ${checkpointId} débloqué et révélé !`);
    
    // Forcer une notification pour vérifier la synchronisation
    setTimeout(() => {
        console.log('🔍 Vérification synchronisation après débloquage:', {
            checkpointId,
            foundCheckpoints,
            unlockedCheckpoints,
            currentTeam: currentTeam?.name,
            currentTeamId
        });
    }, 1000);
}

function centerMapOnCheckpoint(checkpoint) {
    console.log(`🎯 Centrage de la carte sur ${checkpoint.name}`);
    
    // Animation fluide vers le nouveau point
    map.flyTo(checkpoint.coordinates, GAME_CONFIG.zoom, {
        animate: true,
        duration: 2 // 2 secondes d'animation
    });
    
    // Ouvrir le popup automatiquement après l'animation pour montrer le bouton GPS
    setTimeout(() => {
        const markerData = checkpointMarkers.find(m => m.id === checkpoint.id);
        if (markerData) {
            markerData.marker.openPopup();
        }
    }, 2500); // Ouvrir le popup après l'animation
}

async function calculateRoute(from, toCheckpoint) {
    console.log(`🗺️ Calcul de l'itinéraire vers ${toCheckpoint.name}`);
    
    // Stocker la destination pour le recalcul automatique
    currentDestination = toCheckpoint;
    
    // Afficher une notification de chargement
    showNotification('⏳ Calcul de l\'itinéraire en cours...');
    
    try {
        // Supprimer l'ancienne route
        if (currentRoute) {
            map.removeLayer(currentRoute);
            currentRoute = null;
        }
        
        // Coordonnées au format [longitude, latitude] pour ORS
        const start = [from.lng, from.lat];
        const end = [toCheckpoint.coordinates[1], toCheckpoint.coordinates[0]];
        
        console.log('📍 Coordonnées:', { start, end });
        
        // Appel à l'API OpenRouteService
        const response = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking', {
            method: 'POST',
            headers: {
                'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
                'Authorization': GAME_CONFIG.orsApiKey,
                'Content-Type': 'application/json; charset=utf-8'
            },
            body: JSON.stringify({
                coordinates: [start, end],
                format: 'geojson',
                instructions: true,
                language: 'fr'
            })
        });
        
        console.log('📡 Réponse ORS:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Erreur ORS:', errorText);
            throw new Error(`Erreur ORS: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        console.log('📊 Données reçues:', data);
        
        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            console.log('🛣️ Route data:', route);
            
            // Vérifier si on a une géométrie valide
            if (route.geometry) {
                let routeGeoJSON;
                
                // Si c'est une chaîne encodée (polyline), on la décode
                if (typeof route.geometry === 'string') {
                    console.log('🔄 Décodage de la polyline:', route.geometry);
                    const coordinates = decodePolyline(route.geometry);
                    console.log('📍 Coordonnées décodées:', coordinates);
                    routeGeoJSON = {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: coordinates
                        },
                        properties: route
                    };
                } else if (route.geometry.coordinates) {
                    // Si c'est déjà un GeoJSON
                    routeGeoJSON = {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: route.geometry.coordinates
                        },
                        properties: route
                    };
                }
                
                console.log('📍 GeoJSON créé:', routeGeoJSON);
                
                // Vérifier que le GeoJSON a été créé correctement
                if (routeGeoJSON && routeGeoJSON.geometry && routeGeoJSON.geometry.coordinates && routeGeoJSON.geometry.coordinates.length > 0) {
                    // Afficher la route sur la carte
                    currentRoute = L.geoJSON(routeGeoJSON, {
                    style: {
                        color: getTeamColor(),
                        weight: 5,
                        opacity: 0.8,
                        dashArray: '10, 5'
                    }
                }).addTo(map);
                
                // Extraire les instructions si disponibles
                if (route.segments && route.segments[0] && route.segments[0].steps) {
                    const instructions = route.segments[0].steps;
                    displayNavigationInstructions(instructions, route.summary);
                } else {
                    // Instructions basiques si pas de segments détaillés
                    displayBasicNavigation(route.summary);
                }
                
                    console.log('✅ Itinéraire calculé et affiché');
                    showNotification('🧭 Itinéraire GPS calculé !');
                } else {
                    console.error('❌ Impossible de créer le GeoJSON:', routeGeoJSON);
                    showNotification('Erreur: Format de route invalide', 'error');
                }
            } else {
                console.error('❌ Pas de géométrie dans la route:', route);
                showNotification('Erreur: Pas de géométrie de route', 'error');
            }
        }
        
    } catch (error) {
        console.error('❌ Erreur lors du calcul de l\'itinéraire:', error);
        showNotification('Impossible de calculer l\'itinéraire GPS', 'error');
    }
}

function displayNavigationInstructions(steps, summary) {
    const hintText = document.getElementById('hint-text');
    
    // Informations générales
    const distance = (summary.distance / 1000).toFixed(2);
    const duration = Math.round(summary.duration / 60);
    
    // Première instruction
    const firstStep = steps[1] || steps[0]; // Ignorer "Départ"
    const instruction = firstStep ? firstStep.instruction : 'Suivez l\'itinéraire sur la carte';
    
    hintText.innerHTML = `
        <div style="background: #e8f5e8; padding: 1rem; border-radius: 10px; border-left: 4px solid ${getTeamColor()};">
            <h4 style="margin: 0 0 0.5rem 0; color: ${getTeamColor()};">🧭 Navigation GPS</h4>
            <p style="margin: 0 0 0.5rem 0; font-weight: bold;">${instruction}</p>
            <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: #666;">
                <span>📍 ${distance} km</span>
                <span>🚶 ${duration} min</span>
            </div>
        </div>
    `;
}

function displayBasicNavigation(summary) {
    const hintText = document.getElementById('hint-text');
    
    // Informations générales
    const distance = (summary.distance / 1000).toFixed(2);
    const duration = Math.round(summary.duration / 60);
    
    hintText.innerHTML = `
        <div style="background: #e8f5e8; padding: 1rem; border-radius: 10px; border-left: 4px solid ${getTeamColor()};">
            <h4 style="margin: 0 0 0.5rem 0; color: ${getTeamColor()};">🧭 Navigation GPS</h4>
            <p style="margin: 0 0 0.5rem 0; font-weight: bold;">Suivez l'itinéraire tracé sur la carte</p>
            <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: #666;">
                <span>📍 ${distance} km</span>
                <span>🚶 ${duration} min</span>
            </div>
        </div>
    `;
}

function showSuccessModal() {
    const modal = document.getElementById('success-modal');
    const messageEl = document.getElementById('success-message');
    const teamInfoEl = document.getElementById('success-team-info');
    
    // Récupérer le dernier checkpoint (checkpoint final) pour son message personnalisé
    const teamRoute = currentTeam?.route || [];
    const lastCheckpointId = teamRoute[teamRoute.length - 1];
    const finalCheckpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === lastCheckpointId);
    
    // Utiliser le message personnalisé du checkpoint final si disponible
    let customMessage = null;
    let customInstructions = null;
    
    if (finalCheckpoint && finalCheckpoint.clue) {
        customMessage = finalCheckpoint.clue.text;
        customInstructions = finalCheckpoint.clue.instructions;
        console.log('🏁 Message personnalisé du checkpoint final trouvé:', {
            checkpoint: finalCheckpoint.name,
            message: customMessage,
            instructions: customInstructions
        });
    }
    
    // Afficher le message (personnalisé ou par défaut)
    if (customMessage) {
        messageEl.textContent = customMessage;
    } else if (currentTeam && currentTeam.name) {
        messageEl.textContent = `L'équipe "${currentTeam.name}" a terminé son parcours !`;
    } else {
        messageEl.textContent = 'Vous avez terminé le jeu de piste !';
    }
    
    // Afficher les instructions (personnalisées ou par défaut)
    if (customInstructions) {
        teamInfoEl.textContent = customInstructions;
    } else if (currentTeam && currentTeam.name) {
        teamInfoEl.textContent = `Félicitations équipe ${currentTeam.name} ! Vous avez relevé tous les défis de votre parcours. Tous les points restent accessibles pour continuer l'exploration.`;
    } else {
        teamInfoEl.textContent = 'Bravo pour cette belle aventure ! Vous pouvez continuer à explorer.';
    }
    
    modal.style.display = 'block';
    console.log(`🏆 Modal de succès affiché pour l'équipe ${currentTeam?.name}`);
    console.log('📋 Contenu du modal:', {
        message: messageEl.textContent,
        teamInfo: teamInfoEl.textContent
    });
}

function updateUI() {
    updateProgress();
    updatePlayerRouteProgress();
    updateHint();
    // updateHelpUI(); // Plus nécessaire - boutons intégrés dans le parcours
}

function updatePlayerRouteProgress() {
    const routeListElement = document.getElementById('player-route-list');
    
    if (!currentTeam || !currentTeam.route) {
        routeListElement.innerHTML = '<p style="color: #e74c3c;">❌ Aucun parcours défini</p>';
        return;
    }
    
    // Vérifier que les checkpoints sont chargés
    if (!GAME_CONFIG.checkpoints || GAME_CONFIG.checkpoints.length === 0) {
        console.warn('⚠️ updatePlayerRouteProgress appelé avant le chargement des checkpoints');
        routeListElement.innerHTML = '<p style="color: #f39c12;">🔄 Chargement des points...</p>';
        return;
    }
    
    const teamRoute = currentTeam.route;
    let progressHTML = '';
    
    teamRoute.forEach((checkpointId, index) => {
        // Utiliser les données de l'équipe directement pour éviter les désynchronisations
        const teamFoundCheckpoints = currentTeam.foundCheckpoints || [];
        const teamUnlockedCheckpoints = currentTeam.unlockedCheckpoints || [0];
        
        const isFound = teamFoundCheckpoints.includes(checkpointId);
        const isUnlocked = teamUnlockedCheckpoints.includes(checkpointId);
        
        // Debug pour voir l'état de chaque checkpoint
        console.log(`🔍 Checkpoint ${checkpointId} état:`, {
            isFound,
            isUnlocked,
            teamFoundCheckpoints,
            teamUnlockedCheckpoints
        });
        
        // Trouver les infos du checkpoint
        const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === checkpointId);
        const checkpointName = checkpoint ? `${checkpoint.emoji} ${checkpoint.name}` : `Point ${checkpointId}`;
        
        // Debug pour voir si le checkpoint est trouvé
        if (!checkpoint) {
            console.warn(`⚠️ Checkpoint ${checkpointId} non trouvé dans GAME_CONFIG.checkpoints:`, 
                GAME_CONFIG.checkpoints.map(cp => cp.id));
        }
        
        // Déterminer le statut et la couleur avec détails en temps réel
        let statusIcon, statusText, statusColor, clickable = false;
        
        if (isFound) {
            // Checkpoint validé
            statusIcon = '✅';
            statusText = 'validé';
            statusColor = '#27ae60';
        } else if (isUnlocked) {
            // Checkpoint débloqué mais pas encore validé
            
            // Vérifier si une photo/épreuve est en attente de validation admin
            if (checkpoint?.type === 'photo' && pendingPhotoValidations.has(checkpointId)) {
                statusIcon = '⏳';
                statusText = 'en attente validation admin';
                statusColor = '#e67e22'; // Orange
                clickable = true;
            }
            // Vérifier si le checkpoint est dans la zone (peut faire l'épreuve maintenant)
            else if (checkpointsInRange.has(checkpointId)) {
                const typeEmoji = checkpoint?.type === 'photo' ? '📸' : 
                                 checkpoint?.type === 'audio' ? '🎤' : 
                                 checkpoint?.type === 'qcm' ? '📝' : 
                                 checkpoint?.type === 'instruction' ? '📄' : 
                                 checkpoint?.clue?.riddle ? '🧩' : '🎯';
                statusIcon = typeEmoji;
                statusText = 'dans la zone - épreuve disponible';
                statusColor = '#3498db'; // Bleu
                clickable = true;
            }
            // Checkpoint accessible mais hors de portée
            else {
                statusIcon = '🔓';
                statusText = 'accessible (rejoindre la zone)';
                statusColor = '#f39c12'; // Jaune
                clickable = true;
            }
        } else {
            // Checkpoint verrouillé
            statusIcon = '🔒';
            statusText = 'verrouillé';
            statusColor = '#95a5a6'; // Gris
        }
        
        const clickHandler = clickable && userPosition ? `onclick="zoomToCheckpoint(${checkpointId})"` : '';
        const cursorStyle = clickable && userPosition ? 'cursor: pointer;' : '';
        
        // Déterminer les boutons d'aide selon le statut
        let helpButtons = '';
        if (!isFound && !isUnlocked) {
            // Checkpoint verrouillé → bouton demander localisation
            helpButtons = `<button class="help-btn-small help-location" onclick="requestLocationHelpFor(${checkpointId})" title="Demander la localisation">📍</button>`;
        } else if (isUnlocked && !isFound) {
            // Checkpoint débloqué mais pas trouvé → vérifier le type et s'il a une énigme
            console.log(`🔍 Debug checkpoint ${checkpointId}:`, {
                checkpoint,
                type: checkpoint?.type,
                hasClue: !!checkpoint?.clue,
                hasRiddle: !!checkpoint?.clue?.riddle,
                riddleData: checkpoint?.clue?.riddle
            });
            
            // Vérifier si le checkpoint est dans la zone (via le Set global mis à jour par checkProximityToCheckpoints)
            const isInRange = checkpointsInRange.has(checkpointId);
            
            if (checkpoint?.type === 'final') {
                // Point d'arrivée → toujours bouton localisation (pas d'épreuve)
                helpButtons = `<button class="help-btn-small help-location" onclick="requestLocationHelpFor(${checkpointId})" title="Demander l'aide pour trouver le point d'arrivée">🏁</button>`;
            } else if (checkpoint?.type === 'photo') {
                // Checkpoint photo accessible → bouton reprendre seulement si dans la zone
                const challengeButton = isInRange ? `<button class="help-btn-small photo-location" onclick="openChallengeFromPopup(${checkpointId})" title="Reprendre une photo">📸</button>` : '';
                helpButtons = `
                    ${challengeButton}
                    <button class="help-btn-small help-resolution" onclick="requestPhotoHelpFor(${checkpointId})" title="Forcer la validation photo">🆘</button>
                `;
            } else if (checkpoint?.type === 'audio') {
                // Épreuve audio → bouton retenter seulement si dans la zone
                const challengeButton = isInRange ? `<button class="help-btn-small photo-location" onclick="openChallengeFromPopup(${checkpointId})" title="Retenter l'épreuve audio">🎤</button>` : '';
                helpButtons = `
                    ${challengeButton}
                    <button class="help-btn-small help-resolution" onclick="requestAudioHelpFor(${checkpointId})" title="Demander l'aide pour l'épreuve audio">🆘</button>
                `;
            } else if (checkpoint?.type === 'qcm') {
                // Épreuve QCM → bouton retenter seulement si dans la zone
                const challengeButton = isInRange ? `<button class="help-btn-small photo-location" onclick="openChallengeFromPopup(${checkpointId})" title="Retenter le QCM">📝</button>` : '';
                helpButtons = `
                    ${challengeButton}
                    <button class="help-btn-small help-resolution" onclick="requestQCMHelpFor(${checkpointId})" title="Demander l'aide pour le QCM">🆘</button>
                `;
            } else if (checkpoint?.type === 'instruction') {
                // Épreuve instruction → bouton relire seulement si dans la zone
                const challengeButton = isInRange ? `<button class="help-btn-small photo-location" onclick="openChallengeFromPopup(${checkpointId})" title="Relire les instructions">📄</button>` : '';
                helpButtons = `
                    ${challengeButton}
                `;
            } else if (checkpoint?.clue?.riddle) {
                // Avec énigme → bouton afficher seulement si dans la zone
                const challengeButton = isInRange ? `<button class="help-btn-small photo-location" onclick="openChallengeFromPopup(${checkpointId})" title="Afficher l'énigme">🧩</button>` : '';
                helpButtons = `
                    ${challengeButton}
                    <button class="help-btn-small help-resolution" onclick="requestRiddleHelpFor(${checkpointId})" title="Demander l'aide pour l'énigme">🆘</button>
                `;
            } else {
                // Sans énigme → bouton aide localisation
                helpButtons = `<button class="help-btn-small help-location" onclick="requestLocationHelpFor(${checkpointId})" title="Demander de l'aide pour trouver ce point">📍</button>`;
            }
        }
        
        progressHTML += `
            <div class="player-checkpoint-item" 
                 style="color: ${statusColor}; ${cursorStyle}" 
                 ${clickHandler}>
                <div class="checkpoint-info">
                ${statusIcon} ${index + 1}. ${checkpointName} 
                <small>(${statusText})</small>
                ${clickable && userPosition ? ' 🧭' : ''}
                </div>
                <div class="checkpoint-actions">
                    ${helpButtons}
                </div>
            </div>
        `;
    });
    
    routeListElement.innerHTML = progressHTML;
}

// Fonction pour zoomer sur un checkpoint spécifique
function zoomToCheckpoint(checkpointId) {
    const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === checkpointId);
    if (checkpoint && userPosition) {
        // Fermer tous les popups ouverts
        map.closePopup();
        
        // Centrer la carte sur le checkpoint
        map.flyTo(checkpoint.coordinates, GAME_CONFIG.zoom, {
            animate: true,
            duration: 1.5
        });
        
        // Ouvrir le popup du checkpoint après l'animation
        setTimeout(() => {
            const markerData = checkpointMarkers.find(m => m.id === checkpointId);
            if (markerData && markerData.marker) {
                markerData.marker.openPopup();
            }
        }, 2000);
        
        showNotification(`🎯 Zoom vers ${checkpoint.name}`, 'info');
    }
}

// Exposer la fonction globalement
window.zoomToCheckpoint = zoomToCheckpoint;

function updateProgress() {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    if (!currentTeam) {
        progressFill.style.width = '0%';
        progressText.textContent = '0 / 0 défis résolus';
        return;
    }
    
    // 🎯 UTILISER LA MÊME LOGIQUE QUE L'ADMIN (getTeamProgress)
    // Utiliser foundCheckpoints (variable locale) au lieu de currentTeam.foundCheckpoints
    const nonLobbyFound = foundCheckpoints.filter(id => {
        const cp = GAME_CONFIG.checkpoints.find(c => c.id === id);
        return cp && !cp.isLobby;
    });
    
    const nonLobbyTotal = currentTeam.route.filter(id => {
        const cp = GAME_CONFIG.checkpoints.find(c => c.id === id);
        return cp && !cp.isLobby;
    }).length;
    
    const percentage = nonLobbyTotal === 0 ? 0 : Math.round((nonLobbyFound.length / nonLobbyTotal) * 100);
    
    progressFill.style.width = `${percentage}%`;
    progressText.textContent = `${nonLobbyFound.length} / ${nonLobbyTotal} défis résolus`;
    
    console.log('📊 Progression mise à jour (logique admin):', {
        foundCheckpoints: foundCheckpoints,
        nonLobbyFound: nonLobbyFound,
        nonLobbyTotal: nonLobbyTotal,
        percentage: percentage
    });
}

function updateHint() {
    const hintText = document.getElementById('hint-text');
    const gpsBtn = document.getElementById('gps-route-btn');
    
    if (!userPosition) {
        hintText.textContent = 'Trouvez votre position pour commencer l\'aventure !';
        gpsBtn.style.display = 'none';
        return;
    }
    
    // Vérifier si l'équipe a terminé SON parcours (pas tous les checkpoints du jeu)
    const teamRoute = currentTeam?.route || [];
    const nonLobbyRoute = teamRoute.filter(id => id !== 0); // Exclure le lobby
    const nonLobbyFound = foundCheckpoints.filter(id => id !== 0); // Exclure le lobby
    const isTeamGameComplete = nonLobbyRoute.length > 0 && nonLobbyFound.length >= nonLobbyRoute.length;
    
    if (isTeamGameComplete) {
        hintText.textContent = `🎉 Félicitations ! Équipe ${currentTeam?.name || 'votre équipe'} a terminé son parcours !`;
        gpsBtn.style.display = 'none';
        console.log('🏆 Affichage message fin de jeu:', {
            équipe: currentTeam?.name,
            route: nonLobbyRoute,
            trouvés: nonLobbyFound,
            message: 'Parcours équipe terminé'
        });
        return;
    }
    
    // Trouver le prochain checkpoint dans la route de l'équipe (débloqué mais pas trouvé)
    // Réutiliser la variable teamRoute déjà déclarée
    let nextCheckpoint = null;
    
    for (const checkpointId of teamRoute) {
        if (checkpointId === 0) continue; // Ignorer le lobby
        
        const isFound = foundCheckpoints.includes(checkpointId);
        const isUnlocked = unlockedCheckpoints.includes(checkpointId);
        
        if (isUnlocked && !isFound) {
            nextCheckpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === checkpointId);
            break;
        }
    }
    
    console.log('🎯 Prochain checkpoint pour hint:', {
        teamRoute,
        foundCheckpoints,
        unlockedCheckpoints,
        nextCheckpoint: nextCheckpoint?.name || 'Aucun'
    });
    
    if (nextCheckpoint) {
        const distance = calculateDistance(
            userPosition.lat,
            userPosition.lng,
            nextCheckpoint.coordinates[0],
            nextCheckpoint.coordinates[1]
        );
        
        hintText.innerHTML = `
            <strong>${nextCheckpoint.hint}</strong><br>
            <small>Distance approximative: ${distance > 1000 ? 
                (distance/1000).toFixed(1) + ' km' : 
                Math.round(distance) + ' m'}</small><br>
            <small style="color: #666;">💡 Cliquez sur le marqueur ${nextCheckpoint.emoji} pour obtenir l'itinéraire GPS</small>
        `;
        
    } else {
        // Tous les checkpoints débloqués sont trouvés, mais il y en a peut-être des verrouillés
        const lockedCheckpoint = GAME_CONFIG.checkpoints.find(cp => 
            cp.locked && !unlockedCheckpoints.includes(cp.id)
        );
        
        if (lockedCheckpoint) {
            hintText.innerHTML = `<strong>${lockedCheckpoint.hint}</strong>`;
        }
    }
    
    // Cacher le bouton GPS du panneau principal
    gpsBtn.style.display = 'none';
}

function updateStatus(message) {
    document.getElementById('status').textContent = message;
}


function setupEventListeners() {
    // Fermer les modales
    document.querySelector('#clue-modal .close').addEventListener('click', () => {
        document.getElementById('clue-modal').style.display = 'none';
    });
    
    document.getElementById('clue-close-btn').addEventListener('click', () => {
        document.getElementById('clue-modal').style.display = 'none';
    });
    
    // Événements pour le modal photo
    document.querySelector('#photo-modal .close').addEventListener('click', () => {
        document.getElementById('photo-modal').style.display = 'none';
        if (currentPhotoCheckpoint) {
            activeModals.delete(`photo-${currentPhotoCheckpoint.id}`);
            // Ajouter à dismissedModals pour éviter réouverture automatique
            dismissedModals.add(currentPhotoCheckpoint.id);
            console.log(`🚫 Modal photo fermé manuellement pour ${currentPhotoCheckpoint.name}, ajouté à dismissedModals`);
            // Notification pour l'utilisateur
            showNotification(`📸 Modal fermé. Cliquez sur le checkpoint ${currentPhotoCheckpoint.emoji} pour le rouvrir`, 'info');
        }
        resetPhotoInterface();
    });
    
    const startCameraBtn = document.getElementById('start-camera-btn');
    const takePhotoBtn = document.getElementById('take-photo-btn');
    const retakePhotoBtn = document.getElementById('retake-photo-btn');
    const submitPhotoBtn = document.getElementById('submit-photo-btn');
    
    if (startCameraBtn) {
        startCameraBtn.addEventListener('click', startCamera);
        console.log('✅ Event listener attaché à start-camera-btn');
    } else {
        console.error('❌ Bouton start-camera-btn non trouvé');
    }
    
    if (takePhotoBtn) {
        takePhotoBtn.addEventListener('click', takePhoto);
        console.log('✅ Event listener attaché à take-photo-btn');
    } else {
        console.error('❌ Bouton take-photo-btn non trouvé');
    }
    
    if (retakePhotoBtn) {
        retakePhotoBtn.addEventListener('click', retakePhoto);
        console.log('✅ Event listener attaché à retake-photo-btn');
    } else {
        console.error('❌ Bouton retake-photo-btn non trouvé');
    }
    
    if (submitPhotoBtn) {
        submitPhotoBtn.addEventListener('click', () => {
            console.log('🔘 Clic détecté sur submit-photo-btn');
            submitPhoto();
        });
        console.log('✅ Event listener attaché à submit-photo-btn');
    } else {
        console.error('❌ Bouton submit-photo-btn non trouvé');
    }
    
    // Événements pour le modal audio
    document.querySelector('#audio-modal .close').addEventListener('click', () => {
        document.getElementById('audio-modal').style.display = 'none';
        if (currentAudioCheckpoint) {
            activeModals.delete(currentAudioCheckpoint.id);
            // Ajouter à dismissedModals pour éviter réouverture automatique
            dismissedModals.add(currentAudioCheckpoint.id);
            console.log(`🚫 Modal audio fermé manuellement pour ${currentAudioCheckpoint.name}, ajouté à dismissedModals`);
            // Notification pour l'utilisateur
            showNotification(`🎤 Modal fermé. Cliquez sur le checkpoint ${currentAudioCheckpoint.emoji} pour le rouvrir`, 'info');
        }
        resetAudioInterface();
    });
    
    document.getElementById('start-audio-btn').addEventListener('click', startAudioChallenge);
    document.getElementById('stop-audio-btn').addEventListener('click', stopAudioChallenge);
    
    // Événements pour le modal QCM
    document.querySelector('#qcm-modal .close').addEventListener('click', () => {
        document.getElementById('qcm-modal').style.display = 'none';
        
        // Ajouter à dismissedModals pour éviter réouverture automatique
        if (currentQCMCheckpoint) {
            dismissedModals.add(currentQCMCheckpoint.id);
            console.log(`🚫 Modal QCM fermé manuellement pour ${currentQCMCheckpoint.name}, ajouté à dismissedModals`);
        }
        
        // Retirer de activeModals
        if (currentQCMCheckpoint) {
            activeModals.delete(currentQCMCheckpoint.id);
        }
    });
    
    document.getElementById('qcm-submit-btn').addEventListener('click', submitQCMAnswer);
    
    // Événements pour le modal instructions
    document.querySelector('#instruction-modal .close').addEventListener('click', () => {
        document.getElementById('instruction-modal').style.display = 'none';
        
        // Ajouter à dismissedModals pour éviter réouverture automatique
        if (currentInstructionCheckpoint) {
            dismissedModals.add(currentInstructionCheckpoint.id);
            console.log(`🚫 Modal instructions fermé manuellement pour ${currentInstructionCheckpoint.name}, ajouté à dismissedModals`);
        }
        
        // Retirer de activeModals
        if (currentInstructionCheckpoint) {
            activeModals.delete(`instruction-${currentInstructionCheckpoint.id}`);
        }
    });
    
    document.getElementById('instruction-understood-btn').addEventListener('click', handleInstructionUnderstood);
    
    // Événements pour le modal énigme
    document.querySelector('#riddle-modal .close').addEventListener('click', () => {
        document.getElementById('riddle-modal').style.display = 'none';
        
        // Ajouter à dismissedModals pour éviter réouverture automatique
        if (currentRiddleCheckpoint) {
            dismissedModals.add(currentRiddleCheckpoint.id);
            console.log(`🚫 Modal énigme fermé manuellement pour ${currentRiddleCheckpoint.name}, ajouté à dismissedModals`);
        }
        
        // Retirer de activeModals
        if (currentRiddleCheckpoint) {
            activeModals.delete(currentRiddleCheckpoint.id);
        }
    });
    
    document.getElementById('close-success-btn').addEventListener('click', () => {
        document.getElementById('success-modal').style.display = 'none';
        console.log('🎮 Modal de succès fermé - exploration continue');
    });
    
    // Bouton de déconnexion sécurisé
    document.getElementById('disconnect-btn').addEventListener('click', () => {
        const confirmDisconnect = confirm(
            '🚪 Êtes-vous sûr de vouloir vous déconnecter ?\n\n' +
            '✅ Votre progression sera sauvegardée\n' +
            '⚠️ Vous devrez vous reconnecter pour continuer'
        );
        
        if (confirmDisconnect) {
            disconnectTeam();
        }
    });
    
    
    // Événements pour la modal d'énigme
    document.getElementById('riddle-submit').addEventListener('click', () => {
        checkRiddleAnswer();
    });
    
    document.getElementById('riddle-answer').addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            checkRiddleAnswer();
        }
    });
    
    // Anciens boutons d'aide supprimés - maintenant intégrés dans le parcours
    
    // Fermer les modales en cliquant à l'extérieur
    window.addEventListener('click', (event) => {
        const clueModal = document.getElementById('clue-modal');
        const riddleModal = document.getElementById('riddle-modal');
        const successModal = document.getElementById('success-modal');
        
        if (event.target === clueModal) {
            clueModal.style.display = 'none';
        }
        if (event.target === riddleModal) {
            riddleModal.style.display = 'none';
            
            // Ajouter à dismissedModals pour éviter réouverture automatique
            if (currentRiddleCheckpoint) {
                dismissedModals.add(currentRiddleCheckpoint.id);
                console.log(`🚫 Modal énigme fermé manuellement pour ${currentRiddleCheckpoint.name}, ajouté à dismissedModals`);
            }
        }
        if (event.target === successModal) {
            successModal.style.display = 'none';
        }
    });
}

// FONCTION OBSOLÈTE - Plus utilisée depuis la modification du système de victoire
// Les équipes gardent maintenant tous leurs points après la victoire
function restartGame() {
    console.log(`🔄 Restart demandé pour l'équipe ${currentTeam?.name} - FONCTION OBSOLÈTE`);
    
    // Reset local
    foundCheckpoints = [];
    unlockedCheckpoints = [0]; // Remettre au lobby
    document.getElementById('success-modal').style.display = 'none';
    
    // Sauvegarder le reset dans Firebase
    if (firebaseService && currentTeam && currentTeamId) {
        firebaseService.updateTeamProgress(currentTeamId, {
            foundCheckpoints: foundCheckpoints,
            unlockedCheckpoints: unlockedCheckpoints
        });
        console.log('💾 Reset sauvegardé dans Firebase');
    }
    
    // Remettre à jour tous les marqueurs et cercles
    checkpointMarkers.forEach(markerData => {
        const checkpoint = markerData.checkpoint;
        const isUnlocked = unlockedCheckpoints.includes(checkpoint.id);
        const isLocked = checkpoint.locked && !isUnlocked;
        
        let markerClass = 'checkpoint-marker';
        if (isLocked) markerClass += ' locked';
        
        const newIcon = L.divIcon({
            className: markerClass,
            html: isLocked ? '🔒' : checkpoint.emoji,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        markerData.marker.setIcon(newIcon);
        markerData.marker.setPopupContent(`
            <div>
                <h3>${isLocked ? '🔒' : checkpoint.emoji} ${checkpoint.name}</h3>
                <p>${isLocked ? '🔒 Verrouillé' : '🔍 À découvrir'}</p>
                <p><em>${checkpoint.hint}</em></p>
                <p><small>Zone de déclenchement: ${GAME_CONFIG.proximityThreshold}m</small></p>
            </div>
        `);
        
        // Remettre à jour le cercle
        markerData.circle.setStyle({
            color: isLocked ? '#95a5a6' : '#3498db',
            fillColor: isLocked ? '#95a5a6' : '#3498db'
        });
    });
    
    updateUI();
    showNotification('Jeu redémarré ! Bonne chance !');
}

// Conteneur pour les notifications empilées
let notificationContainer = null;

function showNotification(message, type = 'success') {
    // Créer le conteneur s'il n'existe pas
    if (!notificationContainer) {
        notificationContainer = document.createElement('div');
        notificationContainer.id = 'notification-container';
        document.body.appendChild(notificationContainer);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // Ajouter au conteneur (s'empile automatiquement)
    notificationContainer.appendChild(notification);
    
    // Animation d'entrée
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Retirer après 3 secondes
    setTimeout(() => {
        notification.classList.add('hide');
    setTimeout(() => {
        notification.remove();
            // Nettoyer le conteneur si vide
            if (notificationContainer.children.length === 0) {
                notificationContainer.remove();
                notificationContainer = null;
            }
        }, 300);
    }, 3000);
}

// Fonction utilitaire pour calculer la distance entre deux points
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371e3; // Rayon de la Terre en mètres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lng2-lng1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance en mètres
}

// Debug: Fonction pour simuler une position (utile pour les tests)
function simulatePosition(lat, lng) {
    console.log(`🧪 Simulation de position: ${lat}, ${lng}`);
    
    userPosition = { lat, lng, accuracy: 10 };
    updateUserMarker();
    checkProximityToCheckpoints();
    updateHint();
    updateStatus('Position simulée');
}

// ===== MENU DEBUG UNIFIÉ =====
function showUnifiedDebugMenu() {
    const existingPanel = document.getElementById('unified-debug-panel');
    if (existingPanel) {
        existingPanel.remove();
        return;
    }

    const panel = document.createElement('div');
    panel.id = 'unified-debug-panel';
    panel.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border: 2px solid #5D2DE6;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        z-index: 10000;
        width: 90vw;
        max-width: 450px;
        text-align: center;
        max-height: 80vh;
        overflow-y: auto;
    `;

    panel.innerHTML = `
        <h3 style="margin-bottom: 15px; color: #333;">🛠️ Menu Debug</h3>
        
        <!-- Section Position -->
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px; text-align: left;">
            <h4 style="margin-bottom: 10px; color: #5D2DE6;">📍 Gestion Position</h4>
            
            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold; font-size: 12px;">Latitude:</label>
                <input type="number" id="debug-lat" step="0.000001" placeholder="49.0956" 
                       style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
            </div>
            
            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold; font-size: 12px;">Longitude:</label>
                <input type="number" id="debug-lng" step="0.000001" placeholder="6.1893" 
                       style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
            </div>
            
            <div style="text-align: center; margin-bottom: 10px;">
                <button onclick="setDebugPosition()" 
                        style="background: #5D2DE6; color: white; border: none; padding: 8px 15px; border-radius: 4px; margin: 2px; font-size: 12px;">
                    📍 Définir Position
                </button>
                <button onclick="getCurrentDebugPosition()" 
                        style="background: #568AC2; color: white; border: none; padding: 8px 15px; border-radius: 4px; margin: 2px; font-size: 12px;">
                    📱 Position Actuelle
                </button>
            </div>
            
            <div style="text-align: center;">
                <strong style="font-size: 12px; margin-bottom: 8px; display: block;">🎯 Positions Rapides</strong>
                <div id="debug-quick-positions">
                    <!-- Les positions seront générées dynamiquement -->
                </div>
            </div>
        </div>
        
        <!-- Section Logging Firebase -->
        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 2px solid #ffc107;">
            <h4 style="margin-bottom: 10px; color: #856404;">📝 Logging Firebase</h4>
            <p style="font-size: 11px; color: #856404; margin-bottom: 10px; text-align: left;">
                Enregistre tous les logs dans Firebase. Les logs sont sauvegardés automatiquement toutes les 10 secondes.
            </p>
            <div style="display: flex; gap: 8px; justify-content: center; margin-bottom: 10px;">
                <button id="start-firebase-logging-btn" onclick="startFirebaseLogging()" 
                        style="background: #28a745; color: white; border: none; padding: 10px 15px; border-radius: 4px; font-size: 13px; font-weight: bold;">
                    ▶️ Commencer à Logger
                </button>
                <button id="stop-firebase-logging-btn" onclick="stopFirebaseLogging()" 
                        style="background: #dc3545; color: white; border: none; padding: 10px 15px; border-radius: 4px; font-size: 13px; font-weight: bold; opacity: 0.5;">
                    ⏹️ Arrêter de Logger
                </button>
            </div>
            <button onclick="downloadFirebaseLogs()" 
                    style="background: #17a2b8; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 12px; width: 100%;">
                📥 Télécharger les Logs
            </button>
            <div id="firebase-logging-status" style="margin-top: 10px; font-size: 11px; color: #856404; text-align: center;">
                <span id="logging-session-info"></span>
            </div>
        </div>
        
        <!-- Section Outils Debug -->
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
            <h4 style="margin-bottom: 10px; color: #5D2DE6;">🔧 Outils Debug</h4>
            <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">
                <button onclick="window.showMetrics()" 
                        style="background: #e74c3c; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 12px;">
                    📊 Métriques
                </button>
                <button onclick="window.healthCheck()" 
                        style="background: #27ae60; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 12px;">
                    🏥 Santé
                </button>
                <button onclick="showGameState()" 
                        style="background: #f39c12; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 12px;">
                    🎮 État Jeu
                </button>
                <button onclick="toggleDebugMode()" 
                        style="background: #9b59b6; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 12px;">
                    🔍 Debug Mode
                </button>
                <button onclick="checkPermissionsStatus()" 
                        style="background: #e67e22; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 12px;">
                    🔐 Permissions
                </button>
                <button onclick="forceCheckpointSync()" 
                        style="background: #27ae60; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 12px;">
                    🔄 Sync Points
                </button>
                <button onclick="showBrowserInfo()" 
                        style="background: #3498db; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 12px;">
                    🌐 Navigateur
                </button>
                <button onclick="showMobileConsole()" 
                        style="background: #9b59b6; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 12px;">
                    📱 Console Mobile
                </button>
                <button onclick="forceBrowserRedetection()" 
                        style="background: #f39c12; color: white; border: none; padding: 8px 12px; border-radius: 4px; font-size: 12px;">
                    🔄 Re-détecter Navigateur
                </button>
            </div>
        </div>
        
        <button onclick="closeUnifiedDebugMenu()" 
                style="background: #e74c3c; color: white; border: none; padding: 10px 20px; border-radius: 4px;">
            ❌ Fermer
        </button>
    `;

    document.body.appendChild(panel);
    
    // Générer les positions rapides dynamiquement
    generateQuickPositions();
    
    // Mettre à jour l'état des boutons de logging Firebase
    updateFirebaseLoggingButtons();
}

function generateQuickPositions() {
    const container = document.getElementById('debug-quick-positions');
    if (!container) return;
    
    let buttonsHTML = '';
    
    // Positions fixes par défaut
    const defaultPositions = [
        { name: '🏠 Luxembourg', lat: 49.095684, lng: 6.189308, color: '#008000' },
        { name: '🗼 Paris', lat: 48.8566, lng: 2.3522, color: '#008000' },
        { name: '🇧🇪 Bruxelles', lat: 50.8503, lng: 4.3517, color: '#008000' }
    ];
    
    // Ajouter les positions des checkpoints du jeu en cours
    if (GAME_CONFIG && GAME_CONFIG.checkpoints && GAME_CONFIG.checkpoints.length > 0) {
        buttonsHTML += '<div style="margin-bottom: 8px;"><strong style="font-size: 11px; color: #5D2DE6;">📍 Checkpoints du Jeu:</strong></div>';
        
        GAME_CONFIG.checkpoints.forEach((checkpoint, index) => {
            // Les coordonnées sont dans checkpoint.coordinates [lat, lng]
            if (checkpoint.coordinates && checkpoint.coordinates.length >= 2) {
                const lat = checkpoint.coordinates[0];
                const lng = checkpoint.coordinates[1];
                const isFound = foundCheckpoints.includes(checkpoint.id);
                const isUnlocked = unlockedCheckpoints.includes(checkpoint.id);
                
                let icon = checkpoint.emoji || '📍';
                let color = '#568AC2';
                let status = '';
                
                // Icônes selon le type si pas d'emoji
                if (!checkpoint.emoji) {
                    switch(checkpoint.type) {
                        case 'lobby': icon = '🏠'; break;
                        case 'enigma': icon = '🧩'; break;
                        case 'photo': icon = '📸'; break;
                        case 'audio': icon = '🎤'; break;
                        case 'qcm': icon = '📋'; break;
                        case 'info': icon = 'ℹ️'; break;
                        case 'final': icon = '🏆'; break;
                    }
                }
                
                // Couleur selon le statut
                if (isFound) {
                    color = '#27ae60';
                    status = ' ✅';
                } else if (isUnlocked) {
                    color = '#f39c12';
                    status = ' 🔓';
                } else {
                    color = '#95a5a6';
                    status = ' 🔒';
                }
                
                const shortName = checkpoint.name && checkpoint.name.length > 12 ? 
                    checkpoint.name.substring(0, 12) + '...' : 
                    (checkpoint.name || `Point ${index + 1}`);
                
                buttonsHTML += `
                    <button onclick="simulatePosition(${lat}, ${lng})" 
                            style="background: ${color}; color: white; border: none; padding: 4px 8px; border-radius: 4px; margin: 1px; font-size: 10px; max-width: 120px; overflow: hidden;">
                        ${icon} ${shortName}${status}
                    </button>
                `;
            }
        });
        
        buttonsHTML += '<div style="margin: 8px 0;"><strong style="font-size: 11px; color: #008000;">🌍 Positions Fixes:</strong></div>';
    } else {
        // Pas de checkpoints chargés
        buttonsHTML += '<div style="margin-bottom: 8px; color: #f39c12; font-size: 11px;">⏳ Checkpoints en cours de chargement...</div>';
        buttonsHTML += '<div style="margin: 8px 0;"><strong style="font-size: 11px; color: #008000;">🌍 Positions Fixes:</strong></div>';
    }
    
    // Ajouter les positions fixes
    defaultPositions.forEach(pos => {
        buttonsHTML += `
            <button onclick="simulatePosition(${pos.lat}, ${pos.lng})" 
                    style="background: ${pos.color}; color: white; border: none; padding: 6px 10px; border-radius: 4px; margin: 2px; font-size: 11px;">
                ${pos.name}
            </button>
        `;
    });
    
    container.innerHTML = buttonsHTML;
}

function setDebugPosition() {
    const lat = parseFloat(document.getElementById('debug-lat').value);
    const lng = parseFloat(document.getElementById('debug-lng').value);
    
    if (isNaN(lat) || isNaN(lng)) {
        alert('⚠️ Coordonnées invalides !');
        return;
    }
    
    simulatePosition(lat, lng);
    showNotification(`📍 Position définie: ${lat.toFixed(6)}, ${lng.toFixed(6)}`, 'success');
}

function getCurrentDebugPosition() {
    if (userPosition) {
        document.getElementById('debug-lat').value = userPosition.lat.toFixed(6);
        document.getElementById('debug-lng').value = userPosition.lng.toFixed(6);
        showNotification('📱 Position actuelle chargée', 'info');
    } else {
        showNotification('❌ Aucune position disponible', 'error');
    }
}

function closeUnifiedDebugMenu() {
    const panel = document.getElementById('unified-debug-panel');
    if (panel) {
        panel.remove();
    }
}

function showGameState() {
    const state = {
        currentTeam: currentTeam?.name || 'Aucune',
        foundCheckpoints: foundCheckpoints.length,
        unlockedCheckpoints: unlockedCheckpoints.length,
        userPosition: userPosition ? `${userPosition.lat.toFixed(6)}, ${userPosition.lng.toFixed(6)}` : 'Aucune',
        gameStarted: gameStarted,
        totalCheckpoints: GAME_CONFIG.checkpoints?.length || 0
    };
    
    alert(`🎮 État du Jeu:\n\n` +
          `👥 Équipe: ${state.currentTeam}\n` +
          `✅ Trouvés: ${state.foundCheckpoints}/${state.totalCheckpoints}\n` +
          `🔓 Débloqués: ${state.unlockedCheckpoints}\n` +
          `📍 Position: ${state.userPosition}\n` +
          `🚀 Jeu démarré: ${state.gameStarted ? 'Oui' : 'Non'}`);
}

function toggleDebugMode() {
    const debugPanel = document.getElementById('debug-panel');
    if (debugPanel.style.display === 'none') {
        enableDebugMode();
        showNotification('🔧 Mode debug desktop activé !', 'success');
    } else {
        debugPanel.style.display = 'none';
        showNotification('🔧 Mode debug desktop désactivé', 'info');
    }
}

// Exposition globale pour les boutons et console
window.setDebugPosition = setDebugPosition;
window.getCurrentDebugPosition = getCurrentDebugPosition;
window.closeUnifiedDebugMenu = closeUnifiedDebugMenu;
window.showUnifiedDebugMenu = showUnifiedDebugMenu;
window.simulatePosition = simulatePosition;
window.showGameState = showGameState;
window.toggleDebugMode = toggleDebugMode;
window.generateQuickPositions = generateQuickPositions;
window.checkPermissionsStatus = checkPermissionsStatus;
window.requestAllPermissions = requestAllPermissions;
window.forceCheckpointSync = forceCheckpointSync;
window.showBrowserInfo = showBrowserInfo;
window.retryMobileGeolocation = retryMobileGeolocation;
window.showMobileGeolocationHelp = showMobileGeolocationHelp;
window.showMobileConsole = showMobileConsole;
window.clearMobileConsole = clearMobileConsole;
window.copyConsoleToClipboard = copyConsoleToClipboard;
window.toggleConsoleAutoScroll = toggleConsoleAutoScroll;
window.closeMobileConsole = closeMobileConsole;
window.forceBrowserRedetection = forceBrowserRedetection;

// Fonction appelée depuis le popup du marqueur
function calculateRouteFromPopup(checkpointId) {
    const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === checkpointId);
    
    if (!checkpoint) {
        showNotification('Checkpoint introuvable', 'error');
        return;
    }
    
    if (!userPosition) {
        showNotification('📍 Position GPS en cours de détection...', 'info');
        return;
    }
    
        // Fermer tous les popups ouverts
        map.closePopup();
        
        calculateRoute(userPosition, checkpoint);
}

// Ouvrir manuellement une épreuve depuis le popup (bypass dismissedModals)
function openChallengeFromPopup(checkpointId) {
    console.log('🎯 [POPUP] Tentative ouverture manuelle checkpoint:', checkpointId);
    
    // Fermer le menu mobile si ouvert
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu && mobileMenu.classList.contains('open')) {
        closeMobileMenu();
    }
    
    const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) {
        console.error('❌ [POPUP] Checkpoint non trouvé:', checkpointId);
        showNotification('❌ Checkpoint introuvable', 'error');
        return;
    }
    
    console.log('✅ [POPUP] Checkpoint trouvé:', checkpoint.name, 'Type:', checkpoint.type);
    
    // VÉRIFICATION ANTI-TRICHE : Vérifier que l'utilisateur est dans la zone du checkpoint
    if (!userPosition) {
        console.warn('⚠️ [POPUP] Position utilisateur inconnue');
        showNotification('⚠️ Position GPS non disponible', 'warning');
        return;
    }
    
    const distance = calculateDistance(
        userPosition.lat,
        userPosition.lng,
        checkpoint.coordinates[0],
        checkpoint.coordinates[1]
    );
    
    console.log(`📏 [POPUP] Distance au checkpoint: ${distance.toFixed(1)}m (seuil: ${GAME_CONFIG.proximityThreshold}m)`);
    
    if (distance > GAME_CONFIG.proximityThreshold) {
        console.warn(`⚠️ [POPUP] Trop loin du checkpoint (${distance.toFixed(1)}m > ${GAME_CONFIG.proximityThreshold}m)`);
        showNotification(`⚠️ Vous devez être dans la zone du checkpoint (${distance.toFixed(0)}m restants)`, 'warning');
        return;
    }
    
    // Retirer de dismissedModals pour permettre l'ouverture manuelle
    if (dismissedModals.has(checkpointId)) {
        dismissedModals.delete(checkpointId);
        console.log(`🔓 [POPUP] Checkpoint ${checkpoint.name} retiré de dismissedModals (ouverture manuelle)`);
    }
    
    // Fermer le popup
    map.closePopup();
    
    // Ouvrir le modal correspondant au type de checkpoint
    console.log(`🚀 [POPUP] Ouverture modal ${checkpoint.type} pour ${checkpoint.name}`);
    
    if (checkpoint.type === 'photo') {
        showPhotoChallenge(checkpoint);
    } else if (checkpoint.type === 'audio') {
        showAudioChallenge(checkpoint);
    } else if (checkpoint.type === 'qcm') {
        showQCMChallenge(checkpoint);
    } else if (checkpoint.type === 'instruction') {
        showInstructionChallenge(checkpoint);
    } else if (checkpoint.clue?.riddle) {
        // Checkpoint avec énigme
        showRiddle(checkpoint.clue, checkpoint);
    } else {
        console.warn('⚠️ [POPUP] Type de checkpoint non géré:', checkpoint.type);
        showNotification(`⚠️ Type d'épreuve non supporté: ${checkpoint.type}`, 'warning');
    }
}

// Exposer les fonctions pour les tests et les popups
window.simulatePosition = simulatePosition;
window.calculateRouteFromPopup = calculateRouteFromPopup;
window.openChallengeFromPopup = openChallengeFromPopup;
window.requestLocationHelpFor = requestLocationHelpFor;
window.requestRiddleHelpFor = requestRiddleHelpFor;
window.requestAudioHelpFor = requestAudioHelpFor;
window.requestPhotoHelpFor = requestPhotoHelpFor;
window.requestQCMHelpFor = requestQCMHelpFor;
window.showPhotoChallenge = showPhotoChallenge;

// Fonction supprimée - les checkpoints sont maintenant créés via l'admin

// Démarrer la synchronisation temps réel avec l'équipe
function startTeamSync() {
    if (!firebaseService || !currentTeamId) {
        console.warn('⚠️ Impossible de démarrer la synchronisation équipe:', {firebaseService: !!firebaseService, currentTeamId});
        return;
    }
    
    console.log('🔄 Démarrage synchronisation temps réel équipe:', currentTeamId);
    console.log('🔍 État Firebase avant listener:', {
        firebaseService: !!firebaseService,
        currentTeamId: currentTeamId,
        db: firebaseService?.db ? 'connecté' : 'non connecté'
    });
    
    // Enregistrer le listener et sa fonction de désinscription
    try {
        console.log('🔗 Tentative d\'enregistrement du listener Firebase pour:', currentTeamId);
        firebaseListenerUnsubscribe = firebaseService.onTeamChange(currentTeamId, (teamData) => {
            const now = Date.now();
            console.log(`📡 [${new Date().toLocaleTimeString()}] Mise à jour reçue de l'équipe:`, {
                name: teamData?.name,
                foundCheckpoints: teamData?.foundCheckpoints,
                unlockedCheckpoints: teamData?.unlockedCheckpoints,
                route: teamData?.route,
                timestamp: now
            });
            firebaseListenerActive = true;
            lastFirebaseUpdate = now;
        
        if (!teamData) {
            console.warn('⚠️ Données d\'équipe vides reçues');
            return;
        }
        
        // Mettre à jour les données de l'équipe
        currentTeam = teamData;
        
        // Vérifier si les checkpoints débloqués ont changé (action admin)
        const newUnlockedCheckpoints = teamData.unlockedCheckpoints || [0];
        const currentUnlocked = unlockedCheckpoints || [0];
        
        const hasNewUnlocked = newUnlockedCheckpoints.some(id => !currentUnlocked.includes(id));
        
        if (hasNewUnlocked) {
            console.log('🔓 Nouveaux checkpoints débloqués par admin:', {
                avant: currentUnlocked,
                après: newUnlockedCheckpoints,
                nouveaux: newUnlockedCheckpoints.filter(id => !currentUnlocked.includes(id))
            });
            
            // Mettre à jour les checkpoints débloqués
            unlockedCheckpoints = [...newUnlockedCheckpoints];
            
            // Révéler les nouveaux checkpoints sur la carte
            const newlyUnlocked = newUnlockedCheckpoints.filter(id => !currentUnlocked.includes(id));
            newlyUnlocked.forEach(checkpointId => {
                if (checkpointId !== 0) { // Ignorer le lobby
                    revealCheckpointOnMap(checkpointId);
                }
            });
            
            // Mettre à jour l'interface
            updateUI();
            
            // Notification à l'utilisateur
            if (newlyUnlocked.length > 0) {
                const checkpointNames = newlyUnlocked.map(id => {
                    const cp = GAME_CONFIG.checkpoints.find(c => c.id === id);
                    return cp ? cp.name : `Point ${id}`;
                }).join(', ');
                
                showNotification(`🎯 Admin a débloqué : ${checkpointNames}`, 'success');
            }
        }
        
        // 1 ÉQUIPE = 1 JOUEUR : Synchroniser foundCheckpoints avec Firebase
        const firebaseFoundCheckpoints = teamData.foundCheckpoints || [];
        const localFoundCheckpoints = foundCheckpoints || [];
        
        // Vérifier s'il y a des différences (pas juste la longueur)
        const firebaseSet = new Set(firebaseFoundCheckpoints);
        const localSet = new Set(localFoundCheckpoints);
        const hasNewFromFirebase = firebaseFoundCheckpoints.some(id => !localSet.has(id));
        const hasDifferentLength = firebaseFoundCheckpoints.length !== localFoundCheckpoints.length;
        
        if (hasNewFromFirebase || hasDifferentLength) {
            const nouveauxCheckpoints = firebaseFoundCheckpoints.filter(id => !localSet.has(id));
            console.log('🔄 Synchronisation foundCheckpoints depuis Firebase:', {
                local: localFoundCheckpoints,
                firebase: firebaseFoundCheckpoints,
                nouveaux: nouveauxCheckpoints,
                longueurDifférente: hasDifferentLength
            });
            
            // Notifier l'utilisateur des nouveaux checkpoints validés et fermer les modaux
            if (nouveauxCheckpoints.length > 0) {
                nouveauxCheckpoints.forEach(cpId => {
                    const cp = GAME_CONFIG.checkpoints.find(c => c.id === cpId);
                    if (cp) {
                        // Afficher notification de succès
                        const successMsg = cp.clue?.successMessage || `✅ ${cp.name} validé !`;
                        showNotification(successMsg, 'success');
                        
                        // Fermer les modaux pour ce checkpoint s'ils sont ouverts
                        const photoModal = document.getElementById('photo-modal');
                        const audioModal = document.getElementById('audio-modal');
                        const qcmModal = document.getElementById('qcm-modal');
                        const riddleModal = document.getElementById('riddle-modal');
                        
                        // Vérifier et fermer le modal photo
                        if (photoModal && photoModal.style.display !== 'none' && currentPhotoCheckpoint?.id === cpId) {
                            console.log(`🔴 Fermeture modal photo pour checkpoint ${cpId} validé par admin`);
                            photoModal.style.display = 'none';
                            activeModals.delete(`photo-${cpId}`);
                            dismissedModals.add(cpId);
                            resetPhotoInterface();
                        }
                        
                        // Vérifier et fermer le modal audio
                        if (audioModal && audioModal.style.display !== 'none' && currentAudioCheckpoint?.id === cpId) {
                            console.log(`🔴 Fermeture modal audio pour checkpoint ${cpId} validé par admin`);
                            audioModal.style.display = 'none';
                            activeModals.delete(cpId);
                            dismissedModals.add(cpId);
                            resetAudioInterface();
                        }
                        
                        // Vérifier et fermer le modal QCM
                        if (qcmModal && qcmModal.style.display !== 'none' && currentQCMCheckpoint?.id === cpId) {
                            console.log(`🔴 Fermeture modal QCM pour checkpoint ${cpId} validé par admin`);
                            qcmModal.style.display = 'none';
                            activeModals.delete(cpId);
                            dismissedModals.add(cpId);
                        }
                        
                        // Vérifier et fermer le modal énigme
                        if (riddleModal && riddleModal.style.display !== 'none' && currentRiddleCheckpoint?.id === cpId) {
                            console.log(`🔴 Fermeture modal énigme pour checkpoint ${cpId} validé par admin`);
                            riddleModal.style.display = 'none';
                            activeModals.delete(cpId);
                            dismissedModals.add(cpId);
                        }
                    }
                });
            }
            
            foundCheckpoints = [...firebaseFoundCheckpoints];
            
            // ⚡ MISE À JOUR IMMÉDIATE de l'affichage après synchronisation
            updatePlayerRouteProgress();
            updateProgress();
            updateUI(); // Force la mise à jour complète
            
            console.log('✅ Interface mise à jour après sync foundCheckpoints');
        } else {
            console.log('📱 foundCheckpoints locaux à jour:', {
                local: localFoundCheckpoints,
                firebase: firebaseFoundCheckpoints
            });
        }
        
        // Mettre à jour les infos d'équipe
        showTeamInfo();
        updateProgress();
        updatePlayerRouteProgress(); // S'assurer que l'affichage est toujours à jour
        
        // Plus besoin de vérifier les demandes d'aide - intégrées dans le parcours
        });
        
        console.log('✅ Listener Firebase enregistré avec succès');
        
        // Démarrer le monitoring du listener
        startFirebaseMonitoring();
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'enregistrement du listener Firebase:', error);
        console.error('📊 Détails erreur:', {
            message: error.message,
            stack: error.stack,
            currentTeamId: currentTeamId
        });
        
        // ===== ANCIEN: Fallback polling désactivé =====
        // Maintenant l'auto-save gère tout, pas besoin de fallback polling
        // startFallbackPolling(); // DÉSACTIVÉ
    }
    
    // Écouter les notifications de refus d'aide/validation
    // ✅ TOUJOURS reconfigurer les listeners même si startTeamSync est appelée plusieurs fois
    setupNotificationListeners();
    
    // 👑 Écouter les logs admin pour cette équipe
    setupAdminLogsListener();
    
    console.log('✅ Synchronisation équipe démarrée avec succès');
}

// ===== ANCIEN SYSTÈME DE MONITORING DÉSACTIVÉ =====
// COMMENTÉ : Le fallback polling est maintenant remplacé par l'auto-save intelligent
// qui sauvegarde toutes les 10s avec throttling
// Le listener Firebase reste actif pour recevoir les changements de l'admin
function startFirebaseMonitoring() {
    console.log('🔍 Monitoring Firebase désactivé - auto-save actif');
    // startFallbackPolling(); // DÉSACTIVÉ - remplacé par auto-save
}

// Système de polling de secours si le listener temps réel ne fonctionne pas
function startFallbackPolling() {
    if (fallbackPollingInterval) {
        console.log('ℹ️ Fallback polling déjà actif');
        return;
    }
    
    console.log('🔄 Démarrage du polling Firebase (vérification toutes les 5s)');
    
    // Première vérification immédiate
    pollTeamData();
    
    fallbackPollingInterval = setInterval(async () => {
        await pollTeamData();
    }, 5000); // Vérifier toutes les 5 secondes
}

// Fonction de polling des données équipe
async function pollTeamData() {
    if (!firebaseService || !currentTeamId) return;
    
    try {
        const teamData = await firebaseService.getTeam(currentTeamId);
            
        if (teamData) {
            // Appliquer les mêmes mises à jour que le listener temps réel
            currentTeam = teamData;
            
            // Vérifier les changements
            const firebaseFoundCheckpoints = teamData.foundCheckpoints || [];
            const localFoundCheckpoints = foundCheckpoints || [];
            const hasChanges = JSON.stringify(firebaseFoundCheckpoints.sort()) !== JSON.stringify(localFoundCheckpoints.sort());
            
            if (hasChanges) {
                const nouveauxCheckpoints = firebaseFoundCheckpoints.filter(id => !localFoundCheckpoints.includes(id));
                
                // Log admin visible pour debug
                logToAdminConsole('🔄 SYNC', `Nouveaux checkpoints: ${nouveauxCheckpoints.length}`, 'info');
                
                // Notifier l'utilisateur des nouveaux checkpoints validés
                if (nouveauxCheckpoints.length > 0) {
                    nouveauxCheckpoints.forEach(cpId => {
                        const cp = GAME_CONFIG.checkpoints.find(c => c.id === cpId);
                        if (cp && cp.type === 'photo') {
                            const successMsg = cp.clue?.successMessage || `✅ Photo validée pour "${cp.name}" !`;
                            showNotification(successMsg, 'success');
                            logToAdminConsole('✅ PHOTO', `${cp.name} validée`, 'success');
                        }
                    });
                }
                
                foundCheckpoints = [...firebaseFoundCheckpoints];
                unlockedCheckpoints = [...(teamData.unlockedCheckpoints || [0])];
                
                updatePlayerRouteProgress();
                updateProgress();
                updateUI();
                
                // Mise à jour du timestamp pour le health check
                lastFirebaseUpdate = Date.now();
                firebaseListenerActive = true;
            }
        }
    } catch (error) {
        console.error('❌ [Polling] Erreur lors du polling:', error);
    }
}

// Écouter les logs admin de l'équipe
function setupAdminLogsListener() {
    if (!firebaseService || !currentTeamId) {
        console.warn('⚠️ Impossible de configurer les logs admin - service non disponible');
        return;
    }
    
    console.log('👑 Démarrage écoute des logs admin pour équipe:', currentTeamId);
    
    // Écouter les logs admin pour cette équipe
    firebaseService.onTeamAdminLogs(currentTeamId, (logs) => {
        console.log(`👑 ${logs.length} logs admin reçus`, logs);
        
        // Afficher chaque nouveau log dans la console mobile
        logs.forEach(log => {
            // Vérifier si on a déjà affiché ce log
            const alreadyDisplayed = consoleHistory.some(entry => 
                entry.type === 'admin' && entry.message === log.message
            );
            
            if (!alreadyDisplayed) {
                logAdminAction(log.message);
                
                // Optionnel : afficher une notification pour les actions importantes
                if (log.action === 'checkpoint_unlocked') {
                    showNotification(`🔓 Admin: ${log.message}`, 'success');
                } else if (log.action === 'validation_approved') {
                    showNotification(`✅ Admin: ${log.message}`, 'success');
                } else if (log.action === 'help_granted') {
                    showNotification(`🆘 Admin: ${log.message}`, 'success');
                }
            }
        });
    });
}

// Révéler un checkpoint sur la carte (appelé quand l'admin débloque)
function revealCheckpointOnMap(checkpointId) {
    const markerData = checkpointMarkers.find(m => m.id === checkpointId);
    
    if (markerData && markerData.hidden) {
        const checkpoint = markerData.checkpoint;
        
        console.log(`🎭 Révélation du checkpoint ${checkpoint.name} (débloqué par admin)`);
        
        // Créer le cercle de proximité
        const circle = L.circle(checkpoint.coordinates, {
            color: '#f39c12', // Orange pour indiquer débloqué par admin
            fillColor: '#f39c12',
            fillOpacity: 0.1,
            radius: GAME_CONFIG.proximityThreshold,
            weight: 2,
            opacity: 0.6
        }).addTo(map);
        
        // Créer le marqueur
        const markerIcon = L.divIcon({
            className: 'checkpoint-marker admin-unlocked',
            html: checkpoint.emoji,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        
        // Créer une fonction pour générer le contenu du popup (dynamique)
        const generatePopupContent = () => {
            const currentlyFound = foundCheckpoints.includes(checkpoint.id);
            return `
                <div>
                    <h3>${checkpoint.emoji} ${checkpoint.name}</h3>
                    <p>${currentlyFound ? '✅ Découvert !' : '🔓 Débloqué par l\'admin'}</p>
                    ${!currentlyFound ? `<p><em>${checkpoint.hint}</em></p>` : ''}
                    <p><small>Zone de déclenchement: ${GAME_CONFIG.proximityThreshold}m</small></p>
                    <button onclick="calculateRouteFromPopup(${checkpoint.id})">
                        🧭 Calculer l'itinéraire GPS
                    </button>
                </div>
            `;
        };
        
        const marker = L.marker(checkpoint.coordinates, { icon: markerIcon })
            .addTo(map)
            .bindPopup(generatePopupContent());
        
        // Mettre à jour le popup quand il s'ouvre
        marker.on('popupopen', function() {
            this.setPopupContent(generatePopupContent());
        });
        
        // Ajouter un événement de clic pour rouvrir les épreuves si elles ont été fermées manuellement
        marker.on('click', function() {
            // Si le checkpoint est dans dismissedModals, le retirer pour permettre la réouverture
            if (dismissedModals.has(checkpoint.id)) {
                console.log(`🔓 Clic sur marker: ${checkpoint.name} retiré de dismissedModals`);
            }
        });
        
        // Mettre à jour les données du marqueur
        markerData.marker = marker;
        markerData.circle = circle;
        markerData.hidden = false;
        
        // Animation de zoom vers le nouveau checkpoint
        setTimeout(() => {
            centerMapOnCheckpoint(checkpoint);
        }, 500);
    }
}

// Synchronisation temps réel des checkpoints
async function syncCheckpoints() {
    if (!firebaseService) {
        console.warn('⚠️ Firebase Service non disponible pour la synchronisation des checkpoints');
        return;
    }
    
    console.log('🔄 Synchronisation des checkpoints...');
    
    try {
        const checkpoints = await firebaseService.getCheckpoints();
        console.log('🔄 Checkpoints synchronisés:', checkpoints);
        
        if (!checkpoints || checkpoints.length === 0) {
            console.warn('⚠️ Aucun checkpoint trouvé dans Firebase');
            showNotification('⚠️ Aucun checkpoint configuré. Contactez l\'administrateur.', 'error');
            return;
        }
        
        // Vérifier qu'il y a au moins un lobby
        const hasLobby = checkpoints.some(cp => cp.isLobby || cp.type === 'lobby');
        if (!hasLobby) {
            console.warn('⚠️ Aucun lobby trouvé dans les checkpoints');
            showNotification('⚠️ Configuration incomplète. Contactez l\'administrateur.', 'error');
        }
        
        GAME_CONFIG.checkpoints = checkpoints;
        
        // Ajouter les checkpoints à la carte seulement si on a une carte initialisée
        if (isMapInitialized) {
            addCheckpointsToMap();
        }
        
        // Mettre à jour l'affichage du parcours maintenant que les checkpoints sont chargés
        updatePlayerRouteProgress();
        updateUI();
        
        // Rafraîchir le menu debug s'il est ouvert
        const debugPanel = document.getElementById('unified-debug-panel');
        if (debugPanel) {
            generateQuickPositions();
        }
    } catch (error) {
        console.error('❌ Erreur lors de la synchronisation des checkpoints:', error);
        showNotification('❌ Erreur de chargement des points. Rechargez la page.', 'error');
    }
}

// Forcer la resynchronisation des checkpoints (appelé après modification admin)
async function forceCheckpointSync() {
    console.log('🔄 Resynchronisation forcée des checkpoints...');
    await syncCheckpoints();
    
    showNotification('🔄 Checkpoints mis à jour !', 'info');
}

// Afficher les informations du navigateur
function showBrowserInfo() {
    const info = `
🌐 INFORMATIONS NAVIGATEUR:

📱 Navigateur: ${BROWSER_INFO.name}
🔍 User Agent: ${BROWSER_INFO.userAgent}

✅ Détections:
• Safari: ${BROWSER_INFO.isSafari ? '✅' : '❌'}
• iOS: ${BROWSER_INFO.isIOS ? '✅' : '❌'}
• Chrome: ${BROWSER_INFO.isChrome ? '✅' : '❌'}
• Firefox: ${BROWSER_INFO.isFirefox ? '✅' : '❌'}
• Mobile: ${BROWSER_INFO.isMobile ? '✅' : '❌'}
• Desktop: ${BROWSER_INFO.isDesktop ? '✅' : '❌'}

🔧 APIs Supportées:
• Géolocalisation: ${navigator.geolocation ? '✅' : '❌'}
• MediaDevices: ${navigator.mediaDevices ? '✅' : '❌'}
• getUserMedia: ${navigator.mediaDevices?.getUserMedia ? '✅' : '❌'}
• Permissions API: ${navigator.permissions ? '✅' : '❌'}
• Service Worker: ${'serviceWorker' in navigator ? '✅' : '❌'}

💡 Si la détection est incorrecte, utilisez "🔄 Re-détecter"
    `.trim();
    
    console.log(info);
    alert(info);
}

// Forcer la re-détection du navigateur
function forceBrowserRedetection() {
    console.log('🔄 Re-détection forcée du navigateur...');
    console.log('📱 Ancien User Agent:', BROWSER_INFO.userAgent);
    console.log('📱 Nouveau User Agent:', navigator.userAgent);
    
    // Forcer la re-détection
    initializeBrowserDetection();
    
    console.log('✅ Navigateur re-détecté:', BROWSER_INFO);
    alert(`🔄 Navigateur re-détecté !\n\nNouveau navigateur: ${BROWSER_INFO.name}\nMobile: ${BROWSER_INFO.isMobile ? 'Oui' : 'Non'}\n\nUser Agent:\n${BROWSER_INFO.userAgent}`);
}

// Surveillance automatique des modifications de checkpoints
let lastCheckpointUpdate = null;

async function watchCheckpointChanges() {
    if (!firebaseService || !currentTeam) return;
    
    try {
        // Vérifier la dernière modification des checkpoints
        const checkpoints = await firebaseService.getAllCheckpoints();
        
        // Calculer le timestamp de la dernière modification
        const latestUpdate = Math.max(...checkpoints.map(cp => 
            cp.updatedAt ? new Date(cp.updatedAt.seconds * 1000).getTime() : 0
        ));
        
        // Si c'est la première vérification, juste stocker
        if (lastCheckpointUpdate === null) {
            lastCheckpointUpdate = latestUpdate;
            return;
        }
        
        // Si il y a eu des modifications, resynchroniser
        if (latestUpdate > lastCheckpointUpdate) {
            console.log('🔄 Modifications détectées, resynchronisation automatique...');
            lastCheckpointUpdate = latestUpdate;
            await forceCheckpointSync();
        }
        
    } catch (error) {
        console.warn('⚠️ Erreur surveillance checkpoints:', error);
    }
}

// Démarrer la surveillance (toutes les 30 secondes)
function startCheckpointWatcher() {
    // Vérification initiale
    watchCheckpointChanges();
    
    // Surveillance périodique
    setInterval(watchCheckpointChanges, 30000); // 30 secondes
    
    console.log('👁️ Surveillance des modifications de checkpoints activée');
}

// ===== SYSTÈME D'AIDE =====

// Variables pour le système d'aide
let currentHelpRequests = [];
let processedNotifications = new Set(); // Pour éviter les doublons

// ===== SYSTÈME DE PHOTOS =====

// Variables pour la gestion des photos
let currentPhotoCheckpoint = null;
let cameraStream = null;
let capturedPhotoBlob = null;

// Appeler la synchronisation après l'initialisation
// syncTeamData(); // Fonction supprimée - synchronisation gérée dans loadTeamGameData()

// Demander l'aide pour la localisation d'un checkpoint spécifique
async function requestLocationHelpFor(checkpointId) {
    // Fermer le menu mobile si ouvert
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu && mobileMenu.classList.contains('open')) {
        closeMobileMenu();
    }
    
    if (!firebaseService || !currentTeamId) {
        showNotification('Erreur: service non disponible', 'error');
        return;
    }
    
    try {
        const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === checkpointId);
        const checkpointName = checkpoint ? checkpoint.name : `Point ${checkpointId}`;
        const message = `L'équipe ${currentTeam?.name || 'inconnue'} demande la localisation de "${checkpointName}".`;
        
        await firebaseService.createHelpRequest(
            currentTeamId,
            checkpointId,
            'location',
            message
        );
        
        showNotification(`📍 Demande de localisation envoyée pour "${checkpointName}"`, 'success');
        
        // Actualiser l'interface
        updateUI();
        
    } catch (error) {
        console.error('❌ Erreur demande d\'aide localisation:', error);
        showNotification('Erreur lors de l\'envoi de la demande', 'error');
    }
}

// Demander l'aide pour forcer la validation d'une photo
async function requestPhotoHelpFor(checkpointId) {
    // Fermer le menu mobile si ouvert
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu && mobileMenu.classList.contains('open')) {
        closeMobileMenu();
    }
    
    if (!firebaseService || !currentTeamId) {
        showNotification('Erreur: service non disponible', 'error');
        return;
    }
    
    try {
        const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === checkpointId);
        const checkpointName = checkpoint ? checkpoint.name : `Point ${checkpointId}`;
        const message = `L'équipe ${currentTeam?.name || 'inconnue'} demande la validation forcée de la photo "${checkpointName}".`;
        
        await firebaseService.createHelpRequest(currentTeamId, checkpointId, 'photo', message);
        showNotification(`Demande d'aide envoyée pour la photo "${checkpointName}"`, 'success');
        console.log(`📸 Demande validation forcée envoyée pour: ${checkpointName}`);
        
    } catch (error) {
        console.error('❌ Erreur envoi demande aide photo:', error);
        showNotification('Erreur lors de l\'envoi de la demande', 'error');
    }
}

// Demander l'aide pour résoudre une énigme spécifique
async function requestRiddleHelpFor(checkpointId) {
    // Fermer le menu mobile si ouvert
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu && mobileMenu.classList.contains('open')) {
        closeMobileMenu();
    }
    
    if (!firebaseService || !currentTeamId) {
        showNotification('Erreur: service non disponible', 'error');
        return;
    }
    
    try {
        const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === checkpointId);
        const checkpointName = checkpoint ? checkpoint.name : `Point ${checkpointId}`;
        const message = `L'équipe ${currentTeam?.name || 'inconnue'} demande l'aide pour l'énigme "${checkpointName}".`;
        
        await firebaseService.createHelpRequest(
            currentTeamId,
            checkpointId,
            'riddle',
            message
        );
        
        showNotification(`🧩 Demande d'aide envoyée pour l'énigme "${checkpointName}"`, 'success');
        
        // Actualiser l'interface
        updateUI();
        
    } catch (error) {
        console.error('❌ Erreur demande d\'aide énigme:', error);
        showNotification('Erreur lors de l\'envoi de la demande', 'error');
    }
}

// Demander l'aide pour une épreuve audio spécifique
async function requestAudioHelpFor(checkpointId) {
    // Fermer le menu mobile si ouvert
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu && mobileMenu.classList.contains('open')) {
        closeMobileMenu();
    }
    
    if (!firebaseService || !currentTeamId) {
        showNotification('Erreur: service non disponible', 'error');
        return;
    }
    
    try {
        const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === checkpointId);
        const checkpointName = checkpoint ? checkpoint.name : `Point ${checkpointId}`;
        const message = `L'équipe ${currentTeam?.name || 'inconnue'} demande l'aide pour l'épreuve audio "${checkpointName}" (problème de microphone ou de bruit).`;
        
        await firebaseService.createHelpRequest(
            currentTeamId,
            checkpointId,
            'audio',
            message
        );
        
        showNotification(`🎤 Demande d'aide envoyée pour l'épreuve audio "${checkpointName}"`, 'success');
        
        // Actualiser l'interface
        updateUI();
        
    } catch (error) {
        console.error('❌ Erreur demande d\'aide audio:', error);
        showNotification('Erreur lors de l\'envoi de la demande', 'error');
    }
}

// Demander l'aide pour un QCM spécifique
async function requestQCMHelpFor(checkpointId) {
    // Fermer le menu mobile si ouvert
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu && mobileMenu.classList.contains('open')) {
        closeMobileMenu();
    }
    
    if (!firebaseService || !currentTeamId) {
        showNotification('Erreur: service non disponible', 'error');
        return;
    }
    
    try {
        const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === checkpointId);
        const checkpointName = checkpoint ? checkpoint.name : `Point ${checkpointId}`;
        const message = `L'équipe ${currentTeam?.name || 'inconnue'} demande l'aide pour le QCM "${checkpointName}" (question trop difficile).`;
        
        await firebaseService.createHelpRequest(
            currentTeamId,
            checkpointId,
            'qcm',
            message
        );
        
        showNotification(`📋 Demande d'aide envoyée pour le QCM "${checkpointName}"`, 'success');
        
        // Actualiser l'interface
        updateUI();
        
    } catch (error) {
        console.error('❌ Erreur demande d\'aide QCM:', error);
        showNotification('Erreur lors de l\'envoi de la demande', 'error');
    }
}

// ===== FONCTIONS INSTRUCTIONS =====

// Variable pour suivre le checkpoint instruction actuel
let currentInstructionCheckpoint = null;

// Afficher le modal instructions pour un checkpoint
function showInstructionChallenge(checkpoint) {
    console.log(`📄 [showInstructionChallenge] Ouverture pour ${checkpoint?.name}, ID: ${checkpoint?.id}`);
    
    if (!checkpoint || checkpoint.type !== 'instruction') {
        console.error('❌ Checkpoint invalide pour instructions:', checkpoint);
        return;
    }
    
    // Vérifier si l'utilisateur a fermé manuellement ce modal
    if (dismissedModals.has(checkpoint.id)) {
        console.log(`🚫 Modal instructions fermé manuellement pour ${checkpoint.name}, ignoré`);
        return;
    }
    
    // Vérifier si le modal est déjà ouvert pour ce checkpoint
    const instructionModal = document.getElementById('instruction-modal');
    if (instructionModal && instructionModal.style.display === 'flex' && currentInstructionCheckpoint?.id === checkpoint.id) {
        console.log(`🚫 Modal instructions déjà ouvert pour ${checkpoint.name}, ignoré`);
        return;
    }
    
    currentInstructionCheckpoint = checkpoint;
    
    // Récupérer le texte des instructions
    const instructionText = checkpoint.clue?.instruction?.text || checkpoint.clue?.text || 'Instructions non disponibles';
    
    // Afficher le modal
    document.getElementById('instruction-text').textContent = instructionText;
    instructionModal.style.display = 'flex';
    
    // ✅ Marquer comme actif dans le Set
    activeModals.add(`instruction-${checkpoint.id}`);
    
    console.log(`📄 Modal instructions ouvert pour: ${checkpoint.name}`);
}

// Gérer le bouton "J'ai compris"
function handleInstructionUnderstood() {
    try {
        if (!currentInstructionCheckpoint) {
            console.error('❌ Aucun checkpoint instruction actif');
            return;
        }
        
        const checkpoint = currentInstructionCheckpoint;
        console.log(`✅ Instructions comprises pour: ${checkpoint.name}`);
        
        // Fermer le modal
        const instructionModal = document.getElementById('instruction-modal');
        instructionModal.style.display = 'none';
        
        // ✅ Retirer du Set des modals actifs
        activeModals.delete(`instruction-${checkpoint.id}`);
        
        // Marquer comme trouvé et débloquer le suivant
        if (!foundCheckpoints.includes(checkpoint.id)) {
            foundCheckpoints.push(checkpoint.id);
            console.log(`🎯 Checkpoint ${checkpoint.name} validé par instructions`);
        }
        
        // Débloquer le checkpoint suivant selon la route de l'équipe
        if (currentTeam && currentTeam.route) {
            const currentRouteIndex = currentTeam.route.indexOf(checkpoint.id);
            if (currentRouteIndex !== -1 && currentRouteIndex < currentTeam.route.length - 1) {
                const nextCheckpointId = currentTeam.route[currentRouteIndex + 1];
                if (!unlockedCheckpoints.includes(nextCheckpointId)) {
                    // Utiliser unlockCheckpoint() pour révéler le checkpoint sur la carte
                    unlockCheckpoint(nextCheckpointId);
                    
                    const nextCheckpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === nextCheckpointId);
                    if (nextCheckpoint) {
                        console.log(`🔓 Checkpoint suivant débloqué: ${nextCheckpoint.name}`);
                        showNotification(`🎯 ${nextCheckpoint.name} débloqué !`, 'success');
                    }
                }
            }
        }
        
        // Mettre à jour le marker du checkpoint actuel (passer au vert)
        const markerData = checkpointMarkers.find(m => m.id === checkpoint.id);
        if (markerData && markerData.marker) {
            // Changer la couleur du marker et du cercle
            if (markerData.marker) {
                const greenIcon = L.divIcon({
                    className: 'checkpoint-marker-found',
                    html: `✅`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                });
                markerData.marker.setIcon(greenIcon);
            }
            if (markerData.circle) {
                markerData.circle.setStyle({
                    color: '#27ae60',
                    fillColor: '#27ae60'
                });
            }
        }
        
        // Sauvegarder la progression
        if (firebaseService && currentTeam && currentTeamId) {
            try {
                forceSave('instruction_completed');
            } catch (saveError) {
                console.error('❌ Erreur forceSave:', saveError);
                logError(saveError, 'handleInstructionUnderstood > forceSave', false);
            }
        }
        
        // Afficher un message de succès
        const successMessage = checkpoint.clue?.successMessage || `✅ Instructions comprises pour "${checkpoint.name}" !`;
        showNotification(successMessage, 'success');
        
        currentInstructionCheckpoint = null;
    } catch (error) {
        console.error('❌ Erreur dans handleInstructionUnderstood:', error);
        logError(error, 'handleInstructionUnderstood', true);
        showNotification('⚠️ Erreur lors de la validation des instructions', 'error');
    }
}

// ===== FONCTIONS PHOTOS =====

// Afficher le modal photo pour un checkpoint
function showPhotoChallenge(checkpoint) {
    console.log(`🔍 [showPhotoChallenge] Tentative ouverture pour ${checkpoint?.name}, ID: ${checkpoint?.id}`);
    console.log(`🔍 [showPhotoChallenge] États: dismissedModals=${dismissedModals.has(checkpoint?.id)}, pendingValidations=${pendingPhotoValidations.has(checkpoint?.id)}, activeModals=${activeModals.has(`photo-${checkpoint?.id}`)}`);
    
    if (!checkpoint || checkpoint.type !== 'photo') {
        console.error('❌ Checkpoint invalide pour défi photo:', checkpoint);
        return;
    }
    
    // Vérifier si l'utilisateur a fermé manuellement ce modal
    if (dismissedModals.has(checkpoint.id)) {
        console.log(`🚫 Modal photo fermé manuellement pour ${checkpoint.name}, ignoré (sortez de la zone pour réinitialiser)`);
        return;
    }
    
    // Vérifier si une photo est en attente de validation pour ce checkpoint
    if (pendingPhotoValidations.has(checkpoint.id)) {
        console.log(`⏳ Photo en attente de validation pour ${checkpoint.name}, modal bloqué`);
        return;
    }
    
    // ✅ Vérifier le Set activeModals
    if (activeModals.has(`photo-${checkpoint.id}`)) {
        console.log(`🚫 Modal photo déjà actif pour ${checkpoint.name} (activeModals), ignoré`);
        return;
    }
    
    // Vérifier si le modal est déjà ouvert pour ce checkpoint
    const photoModal = document.getElementById('photo-modal');
    if (photoModal && photoModal.style.display === 'flex' && currentPhotoCheckpoint?.id === checkpoint.id) {
        console.log(`🚫 Modal photo déjà ouvert pour ${checkpoint.name} (DOM), ignoré`);
        return;
    }
    
    // Marquer comme actif
    activeModals.add(`photo-${checkpoint.id}`);
    
    currentPhotoCheckpoint = checkpoint;
    
    console.log('📸 Configuration photo trouvée:', checkpoint.clue);
    console.log('📸 Structure complète du checkpoint:', checkpoint);
    
    // Afficher les instructions - support de plusieurs formats
    const instructions = checkpoint.clue.text || checkpoint.clue.instructions || 'Prenez une photo selon les instructions.';
    document.getElementById('photo-instructions').textContent = instructions;
    
    // Réinitialiser l'interface
    resetPhotoInterface();
    
    // Afficher le modal
    document.getElementById('photo-modal').style.display = 'flex';
    
    console.log('📸 Modal photo ouvert pour:', checkpoint.name);
}

// Convertir le seuil de volume en description compréhensible
function getVolumeHint(threshold) {
    if (threshold <= 30) {
        return `${threshold}/100 (~40-50 dB) - Chuchotement ou parler très doucement`;
    } else if (threshold <= 50) {
        return `${threshold}/100 (~50-60 dB) - Conversation calme`;
    } else if (threshold <= 70) {
        return `${threshold}/100 (~60-70 dB) - Conversation normale`;
    } else if (threshold <= 90) {
        return `${threshold}/100 (~70-80 dB) - Parler fort ou crier`;
    } else {
        return `${threshold}/100 (~80+ dB) - Crier très fort, applaudir, taper des mains`;
    }
}

// Afficher le défi audio
function showAudioChallenge(checkpoint) {
    if (!checkpoint || checkpoint.type !== 'audio') {
        console.error('❌ Checkpoint invalide pour défi audio:', checkpoint);
        return;
    }
    
    // Vérifier si l'utilisateur a fermé manuellement ce modal
    if (dismissedModals.has(checkpoint.id)) {
        console.log(`🚫 Modal audio fermé manuellement pour ${checkpoint.name}, ignoré (sortez de la zone pour réinitialiser)`);
        return;
    }
    
    // Protection anti-spam
    if (activeModals.has(checkpoint.id)) {
        console.log(`🚫 Modal audio déjà ouvert pour ${checkpoint.name}`);
        return;
    }
    
    // Vérifier si le modal est déjà ouvert pour ce checkpoint
    const audioModal = document.getElementById('audio-modal');
    if (audioModal && audioModal.style.display === 'flex' && currentAudioCheckpoint?.id === checkpoint.id) {
        console.log(`🚫 Modal audio déjà ouvert pour ${checkpoint.name}, ignoré`);
        return;
    }
    
    // Support des deux formats : audioChallenge (ancien) et audio (nouveau)
    const audioConfig = checkpoint.clue.audio || checkpoint.clue.audioChallenge;
    if (!audioConfig) {
        console.error('❌ Configuration audio manquante:', checkpoint);
        return;
    }
    
    currentAudioCheckpoint = checkpoint;
    
    // Marquer ce modal comme ouvert
    activeModals.add(checkpoint.id);
    
    console.log('🎤 Configuration audio trouvée:', audioConfig);
    console.log('🎤 Structure complète du checkpoint:', checkpoint);
    
    // Afficher les instructions
    document.getElementById('audio-instructions').textContent = audioConfig.instructions || audioConfig.text || 'Faites du bruit pour débloquer ce checkpoint !';
    
    // Ajouter une indication du niveau requis
    const thresholdHint = getVolumeHint(audioConfig.threshold);
    const instructionsElement = document.getElementById('audio-instructions');
    instructionsElement.innerHTML = `
        ${audioConfig.instructions || 'Faites du bruit pour débloquer ce checkpoint !'}
        <br><br>
        <small style="color: #666; font-style: italic;">
            💡 Niveau requis : ${thresholdHint} pendant ${audioConfig.duration} seconde${audioConfig.duration > 1 ? 's' : ''}
        </small>
    `;
    
    // ✅ FIX RADICAL: Pré-créer l'AudioContext AVANT de réinitialiser l'interface
    // pour éviter de le détruire immédiatement
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('🔊 AudioContext pré-créé à l\'ouverture du modal, état:', audioContext.state);
            
            // Activer immédiatement si suspendu
            if (audioContext.state === 'suspended') {
                audioContext.resume().then(() => {
                    console.log('▶️ AudioContext pré-activé à l\'ouverture du modal');
                });
            }
        } catch (error) {
            console.error('❌ Erreur pré-création AudioContext:', error);
        }
    }
    
    // Réinitialiser l'interface visuelle SANS détruire l'AudioContext pré-créé
    resetAudioInterfaceVisual();
    
    // Afficher le modal
    document.getElementById('audio-modal').style.display = 'flex';
    
    console.log('🎤 Modal audio ouvert pour:', checkpoint.name, 'Config:', audioConfig);
}

// Afficher le défi QCM
function showQCMChallenge(checkpoint) {
    if (!checkpoint || checkpoint.type !== 'qcm') {
        console.error('❌ Checkpoint invalide pour défi QCM:', checkpoint);
        return;
    }
    
    // Vérifier si le modal a été fermé manuellement
    if (dismissedModals.has(checkpoint.id)) {
        console.log(`🚫 Modal QCM fermé manuellement pour ${checkpoint.name}, ignoré (cliquez sur le marker pour rouvrir)`);
        return;
    }
    
    // Protection anti-spam
    if (activeModals.has(checkpoint.id)) {
        console.log(`🚫 Modal QCM déjà ouvert pour ${checkpoint.name}`);
        return;
    }
    
    // Vérifier si le modal est déjà ouvert pour ce checkpoint
    const qcmModal = document.getElementById('qcm-modal');
    if (qcmModal && qcmModal.style.display === 'flex' && currentQCMCheckpoint?.id === checkpoint.id) {
        console.log(`🚫 Modal QCM déjà ouvert pour ${checkpoint.name}, ignoré`);
        return;
    }
    
    // Support des formats QCM (nouveau et ancien)
    const qcmConfig = checkpoint.clue.qcm || checkpoint.clue.quiz || checkpoint.clue.mcq;
    if (!qcmConfig) {
        console.error('❌ Configuration QCM manquante:', checkpoint);
        return;
    }
    
    currentQCMCheckpoint = checkpoint;
    
    // Marquer ce modal comme ouvert
    activeModals.add(checkpoint.id);
    
    console.log('📋 Configuration QCM trouvée:', qcmConfig);
    console.log('📋 Structure complète du checkpoint:', checkpoint);
    
    // Afficher la question
    document.getElementById('qcm-question').textContent = qcmConfig.question;
    
    // Générer les réponses
    const answersContainer = document.getElementById('qcm-answers-container');
    answersContainer.innerHTML = '';
    selectedAnswers = [];
    
    qcmConfig.answers.forEach((answer, index) => {
        const answerDiv = document.createElement('div');
        answerDiv.className = 'qcm-answer-option';
        answerDiv.innerHTML = `
            <input type="checkbox" id="qcm-answer-${index}" value="${index}">
            <label for="qcm-answer-${index}">${answer}</label>
        `;
        
        // Ajouter l'événement de clic
        answerDiv.addEventListener('click', () => toggleQCMAnswer(index));
        
        answersContainer.appendChild(answerDiv);
    });
    
    // Réinitialiser le feedback
    const feedback = document.getElementById('qcm-feedback');
    feedback.style.display = 'none';
    feedback.className = 'qcm-feedback';
    
    // Réactiver le bouton
    document.getElementById('qcm-submit-btn').disabled = false;
    
    // Afficher le modal
    document.getElementById('qcm-modal').style.display = 'flex';
    
    console.log('📋 Modal QCM ouvert pour:', checkpoint.name, 'Config:', qcmConfig);
}

// Basculer la sélection d'une réponse QCM
function toggleQCMAnswer(answerIndex) {
    const checkbox = document.getElementById(`qcm-answer-${answerIndex}`);
    const answerDiv = checkbox.closest('.qcm-answer-option');
    
    if (selectedAnswers.includes(answerIndex)) {
        // Désélectionner
        selectedAnswers = selectedAnswers.filter(i => i !== answerIndex);
        checkbox.checked = false;
        answerDiv.classList.remove('selected');
    } else {
        // Sélectionner
        selectedAnswers.push(answerIndex);
        checkbox.checked = true;
        answerDiv.classList.add('selected');
    }
    
    console.log('📋 Réponses sélectionnées:', selectedAnswers);
}

// Valider les réponses du QCM
function submitQCMAnswer() {
    // Support des formats QCM (nouveau et ancien)
    const qcmConfig = currentQCMCheckpoint?.clue?.qcm || currentQCMCheckpoint?.clue?.quiz || currentQCMCheckpoint?.clue?.mcq;
    if (!currentQCMCheckpoint || !qcmConfig) {
        console.error('❌ Configuration QCM manquante:', currentQCMCheckpoint);
        return;
    }
    const correctAnswers = qcmConfig.correctAnswers;
    
    // Vérifier si les réponses sont correctes
    const isCorrect = selectedAnswers.length === correctAnswers.length &&
                     selectedAnswers.every(answer => correctAnswers.includes(answer)) &&
                     correctAnswers.every(answer => selectedAnswers.includes(answer));
    
    // Désactiver le bouton
    document.getElementById('qcm-submit-btn').disabled = true;
    
    // Afficher les résultats visuellement
    const answersContainer = document.getElementById('qcm-answers-container');
    const answerDivs = answersContainer.querySelectorAll('.qcm-answer-option');
    
    answerDivs.forEach((div, index) => {
        const isCorrectAnswer = correctAnswers.includes(index);
        const wasSelected = selectedAnswers.includes(index);
        
        if (isCorrectAnswer) {
            div.classList.add('correct');
        } else if (wasSelected) {
            div.classList.add('incorrect');
        }
        
        // Désactiver les clics
        div.style.pointerEvents = 'none';
    });
    
    // Afficher le feedback
    const feedback = document.getElementById('qcm-feedback');
    feedback.style.display = 'block';
    
    if (isCorrect) {
        feedback.className = 'qcm-feedback success';
        feedback.innerHTML = `
            <div>✅ ${qcmConfig.successMessage || 'Bravo ! Bonne réponse !'}</div>
            ${qcmConfig.explanation ? `<div class="qcm-explanation">💡 ${qcmConfig.explanation}</div>` : ''}
            <button id="qcm-continue-btn" class="qcm-btn primary" style="margin-top: 1rem;">✅ Continuer l'aventure</button>
        `;
        
        console.log('🎉 QCM réussi !');
        
        // Marquer ce checkpoint comme trouvé AVANT de débloquer le suivant
        if (!foundCheckpoints.includes(currentQCMCheckpoint.id)) {
            foundCheckpoints.push(currentQCMCheckpoint.id);
            
            // Mettre à jour le marqueur et le cercle sur la carte
            const markerData = checkpointMarkers.find(m => m.id === currentQCMCheckpoint.id);
            if (markerData) {
                // Mettre à jour l'icône
                if (markerData.marker) {
                const foundIcon = L.divIcon({
                    className: 'checkpoint-marker found',
                    html: currentQCMCheckpoint.emoji,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                });
                markerData.marker.setIcon(foundIcon);
                }
                
                // Mettre à jour le cercle en vert
                if (markerData.circle) {
                    markerData.circle.setStyle({
                        color: '#27ae60',
                        fillColor: '#27ae60'
                    });
                }
            }
            
            // Sauvegarder dans Firebase
            if (firebaseService && currentTeamId) {
                firebaseService.updateTeamProgress(currentTeamId, {
                    foundCheckpoints: foundCheckpoints,
                    updatedAt: new Date()
                }).catch(error => console.error('❌ Erreur sauvegarde QCM:', error));
            }
        }
        
        // Ajouter le listener sur le bouton "Continuer"
        setTimeout(() => {
            const continueBtn = document.getElementById('qcm-continue-btn');
            if (continueBtn) {
                continueBtn.addEventListener('click', () => {
                    console.log('🔘 Clic sur bouton Continuer QCM');
                    
                    // Fermer le modal
                    document.getElementById('qcm-modal').style.display = 'none';
                    activeModals.delete(currentQCMCheckpoint.id);
                    
                    // Marquer comme dismissed
                    if (currentQCMCheckpoint) {
                        dismissedModals.add(currentQCMCheckpoint.id);
                        console.log(`✅ QCM résolu pour ${currentQCMCheckpoint.name}, modal marqué comme dismissed`);
                    }
                    
                    // Débloquer le prochain point et lancer la navigation GPS
                    const nextCheckpointId = getNextCheckpointForTeam();
                    if (nextCheckpointId) {
                        unlockCheckpoint(nextCheckpointId);
                        
                        const nextCheckpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === nextCheckpointId);
                        const nextName = nextCheckpoint ? nextCheckpoint.name : 'prochain point';
                        
                        if (nextCheckpoint) {
                            console.log('🎯 Zoom vers le checkpoint débloqué:', nextCheckpoint.name);
                            centerMapOnCheckpoint(nextCheckpoint);
                            
                            // Lancer la navigation GPS automatique
                            if (userPosition) {
                                calculateRoute(userPosition, nextCheckpoint);
                                showNotification(`🎯 "${nextName}" débloqué ! Navigation GPS activée.`);
                            } else {
                                showNotification(`🎉 "${nextName}" est maintenant débloqué !`);
                            }
                        } else {
                            showNotification(`🎉 "${nextName}" est maintenant débloqué !`);
                        }
                    } else {
                        showNotification('🏆 Parcours terminé ! Félicitations !');
                    }
                });
            }
        }, 100);
        
    } else {
        feedback.className = 'qcm-feedback error';
        feedback.innerHTML = `
            <div>❌ Réponse incorrecte. Essayez encore !</div>
            ${qcmConfig.explanation ? `<div class="qcm-explanation">💡 ${qcmConfig.explanation}</div>` : ''}
        `;
        
        // Permettre de réessayer après un délai
        setTimeout(() => {
            // Réinitialiser l'interface
            answerDivs.forEach(div => {
                div.classList.remove('correct', 'incorrect');
                div.style.pointerEvents = 'auto';
            });
            
            selectedAnswers = [];
            answerDivs.forEach((div, index) => {
                const checkbox = div.querySelector('input[type="checkbox"]');
                checkbox.checked = false;
                div.classList.remove('selected');
            });
            
            feedback.style.display = 'none';
            document.getElementById('qcm-submit-btn').disabled = false;
        }, 2000);
    }
}

// Réinitialiser seulement l'interface visuelle (SANS détruire l'AudioContext)
function resetAudioInterfaceVisual() {
    // Arrêter le stream audio si actif
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    
    // Réinitialiser les éléments visuels
    document.getElementById('audio-status-text').textContent = 'Appuyez sur le bouton pour commencer';
    document.getElementById('audio-progress-container').style.display = 'none';
    const startBtn = document.getElementById('start-audio-btn');
    startBtn.style.display = 'block';
    startBtn.disabled = false; // Réactiver le bouton
    startBtn.textContent = '🎤 Commencer l\'épreuve';
    document.getElementById('stop-audio-btn').style.display = 'none';
    document.getElementById('audio-feedback').innerHTML = '';
    document.getElementById('audio-progress-fill').style.width = '0%';
    document.getElementById('audio-timer').textContent = '0s';
    document.getElementById('audio-level').textContent = 'Volume: 0%';
    
    // Réinitialiser les variables
    audioProgress = 0;
    audioStartTime = null;
    isAudioChallengeActive = false;
    audioAnimationId = null;
}

// Réinitialiser l'interface audio (détruit TOUT y compris l'AudioContext)
function resetAudioInterface() {
    // Arrêter l'audio si actif
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    // Réinitialiser l'interface visuelle
    resetAudioInterfaceVisual();
}

// Démarrer l'épreuve audio
async function startAudioChallenge() {
    const audioConfig = currentAudioCheckpoint?.clue?.audio || currentAudioCheckpoint?.clue?.audioChallenge;
    if (!currentAudioCheckpoint || !audioConfig) {
        console.error('❌ Configuration audio manquante');
        return;
    }
    
    try {
        console.log('🎤 Démarrage épreuve audio...');
        
        // ✅ Désactiver le bouton pour éviter les double-clics
        const startBtn = document.getElementById('start-audio-btn');
        startBtn.disabled = true;
        startBtn.textContent = '⏳ Demande du micro...';
        
        // ✅ Vérifier que l'AudioContext existe (devrait être pré-créé à l'ouverture du modal)
        if (!audioContext) {
            console.warn('⚠️ AudioContext non pré-créé, création maintenant...');
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // ✅ Activer l'AudioContext dans le contexte du clic
        if (audioContext.state === 'suspended') {
            console.log('⏸️ AudioContext suspendu, activation...');
            await audioContext.resume();
            console.log('▶️ AudioContext activé:', audioContext.state);
        }
        
        // Maintenant demander l'accès au microphone
        console.log('🎤 Demande d\'accès au microphone...');
        audioStream = await requestMicrophoneBrowser();
        console.log('✅ Stream audio obtenu');
        
        const source = audioContext.createMediaStreamSource(audioStream);
        
        // Créer l'analyseur
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 256;
        const bufferLength = audioAnalyser.frequencyBinCount;
        audioDataArray = new Uint8Array(bufferLength);
        
        source.connect(audioAnalyser);
        console.log('🔗 Analyseur connecté');
        
        // ✅ Vérifier que tout est bien connecté avant de démarrer
        if (!audioStream.active) {
            throw new Error('Le stream audio n\'est pas actif');
        }
        
        // Démarrer le défi
        isAudioChallengeActive = true;
        audioStartTime = Date.now();
        audioProgress = 0;
        
        // Mettre à jour l'interface
        document.getElementById('audio-status-text').textContent = 'Épreuve en cours... Faites du bruit !';
        document.getElementById('audio-progress-container').style.display = 'block';
        document.getElementById('start-audio-btn').style.display = 'none';
        document.getElementById('stop-audio-btn').style.display = 'block';
        
        // ✅ Petit délai pour s'assurer que tout est bien initialisé
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Démarrer l'animation
        updateAudioProgress();
        
        console.log('✅ Épreuve audio démarrée - AudioContext état:', audioContext.state);
        
    } catch (error) {
        console.error('❌ Erreur accès microphone:', error);
        console.error('📊 Détails:', error.message);
        showAudioFeedback('Impossible d\'accéder au microphone. Vérifiez les permissions.', 'error');
        
        // Réactiver le bouton en cas d'erreur
        const startBtn = document.getElementById('start-audio-btn');
        startBtn.disabled = false;
        startBtn.textContent = '🎤 Commencer l\'épreuve';
        
        // Nettoyer en cas d'erreur
        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
            audioStream = null;
        }
        // NE PAS détruire l'AudioContext ici, on le garde pour le prochain essai
    }
}

// Arrêter l'épreuve audio
function stopAudioChallenge() {
    isAudioChallengeActive = false;
    
    if (audioAnimationId) {
        cancelAnimationFrame(audioAnimationId);
        audioAnimationId = null;
    }
    
    resetAudioInterface();
    console.log('🎤 Épreuve audio arrêtée');
}

// Mettre à jour la progression audio
function updateAudioProgress() {
    if (!isAudioChallengeActive || !audioAnalyser || !currentAudioCheckpoint) {
        return;
    }
    
    const audioConfig = currentAudioCheckpoint.clue.audio || currentAudioCheckpoint.clue.audioChallenge;
    const requiredDuration = audioConfig.duration * 1000; // en millisecondes
    const threshold = audioConfig.threshold;
    
    // Analyser le niveau audio
    audioAnalyser.getByteFrequencyData(audioDataArray);
    
    // Calculer le niveau moyen
    let sum = 0;
    for (let i = 0; i < audioDataArray.length; i++) {
        sum += audioDataArray[i];
    }
    const average = sum / audioDataArray.length;
    const volumeLevel = Math.round((average / 255) * 100);
    
    // Mettre à jour l'affichage du volume
    document.getElementById('audio-level').textContent = `Volume: ${volumeLevel}%`;
    
    // Vérifier si le seuil est atteint
    if (volumeLevel >= threshold) {
        audioProgress += 16; // ~60fps, donc environ 16ms par frame
        
        // Mettre à jour la jauge
        const progressPercent = Math.min((audioProgress / requiredDuration) * 100, 100);
        document.getElementById('audio-progress-fill').style.width = `${progressPercent}%`;
        
        // Mettre à jour le timer
        const elapsedSeconds = Math.floor(audioProgress / 1000);
        const requiredSeconds = Math.floor(requiredDuration / 1000);
        document.getElementById('audio-timer').textContent = `${elapsedSeconds}s / ${requiredSeconds}s`;
        
        // Vérifier si l'épreuve est réussie
        if (audioProgress >= requiredDuration) {
            audioChallengeSucess();
            return;
        }
    } else {
        // Niveau insuffisant, réinitialiser le progrès
        audioProgress = Math.max(0, audioProgress - 32); // Perte plus rapide que le gain
        
        const progressPercent = Math.min((audioProgress / requiredDuration) * 100, 100);
        document.getElementById('audio-progress-fill').style.width = `${progressPercent}%`;
        
        const elapsedSeconds = Math.floor(audioProgress / 1000);
        const requiredSeconds = Math.floor(requiredDuration / 1000);
        document.getElementById('audio-timer').textContent = `${elapsedSeconds}s / ${requiredSeconds}s`;
    }
    
    // Continuer l'animation
    audioAnimationId = requestAnimationFrame(updateAudioProgress);
}

// Succès de l'épreuve audio
function audioChallengeSucess() {
    isAudioChallengeActive = false;
    
    if (audioAnimationId) {
        cancelAnimationFrame(audioAnimationId);
        audioAnimationId = null;
    }
    
    const audioConfig = currentAudioCheckpoint.clue.audio || currentAudioCheckpoint.clue.audioChallenge;
    const successMessage = audioConfig.successMessage || 'Bravo ! Épreuve audio réussie !';
    
    // Marquer le checkpoint comme trouvé maintenant que l'épreuve est réussie
    if (!foundCheckpoints.includes(currentAudioCheckpoint.id)) {
        foundCheckpoints.push(currentAudioCheckpoint.id);
        
        // Mettre à jour le marqueur visuellement
        const markerData = checkpointMarkers.find(m => m.id === currentAudioCheckpoint.id);
        if (markerData) {
            const newIcon = L.divIcon({
                className: 'checkpoint-marker found',
                html: currentAudioCheckpoint.emoji,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });
            markerData.marker.setIcon(newIcon);
        }
        
        // Sauvegarder la progression dans Firebase
        if (firebaseService && currentTeam && currentTeamId) {
            firebaseService.updateTeamProgress(currentTeamId, {
                foundCheckpoints: foundCheckpoints,
                unlockedCheckpoints: unlockedCheckpoints
            });
            
            console.log('💾 Progression épreuve audio sauvegardée:', {
                teamId: currentTeamId,
                foundCheckpoints, 
                unlockedCheckpoints
            });
        }
        
        // Mettre à jour l'interface
        updateUI();
    }
    
    // Afficher le succès avec bouton de continuation
    const audioFeedback = document.getElementById('audio-feedback');
    audioFeedback.innerHTML = `
        <div class="audio-feedback success" style="margin-bottom: 1rem;">
            ✅ ${successMessage}
        </div>
        <button id="audio-continue-btn" class="audio-btn primary">✅ Continuer l'aventure</button>
    `;
    audioFeedback.style.display = 'block';
    
    // Masquer les contrôles
    document.getElementById('start-audio-btn').style.display = 'none';
    document.getElementById('stop-audio-btn').style.display = 'none';
    document.getElementById('audio-status-text').textContent = 'Épreuve réussie !';
    
    console.log('🎉 Épreuve audio réussie !');
    
    // Ajouter le listener sur le bouton "Continuer"
    setTimeout(() => {
        const continueBtn = document.getElementById('audio-continue-btn');
        if (continueBtn) {
            continueBtn.addEventListener('click', () => {
                console.log('🔘 Clic sur bouton Continuer Audio');
                
                // Fermer le modal
                document.getElementById('audio-modal').style.display = 'none';
                
                // Marquer comme dismissed
                if (currentAudioCheckpoint) {
                    activeModals.delete(currentAudioCheckpoint.id);
                    dismissedModals.add(currentAudioCheckpoint.id);
                    console.log(`✅ Audio résolu pour ${currentAudioCheckpoint.name}, modal marqué comme dismissed`);
                }
                
                // Nettoyer les ressources audio
                resetAudioInterface();
                
                // Débloquer le prochain point et lancer la navigation GPS
                const nextCheckpointId = getNextCheckpointForTeam();
                if (nextCheckpointId) {
                    unlockCheckpoint(nextCheckpointId);
                    
                    const nextCheckpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === nextCheckpointId);
                    const nextName = nextCheckpoint ? nextCheckpoint.name : 'prochain point';
                    
                    if (nextCheckpoint) {
                        console.log('🎯 Zoom vers le checkpoint débloqué:', nextCheckpoint.name);
                        centerMapOnCheckpoint(nextCheckpoint);
                        
                        // Lancer la navigation GPS automatique
                        if (userPosition) {
                            calculateRoute(userPosition, nextCheckpoint);
                            showNotification(`🎯 "${nextName}" débloqué ! Navigation GPS activée.`);
                        } else {
                            showNotification(`🎉 "${nextName}" est maintenant débloqué !`);
                        }
                    } else {
                        showNotification(`🎉 "${nextName}" est maintenant débloqué !`);
                    }
                } else {
                    showNotification('🏆 Parcours terminé ! Félicitations !');
                }
            });
        }
    }, 100);
}

// Afficher un feedback audio
function showAudioFeedback(message, type = 'info') {
    const feedback = document.getElementById('audio-feedback');
    feedback.textContent = message;
    feedback.className = `audio-feedback ${type}`;
}

// Réinitialiser l'interface photo
function resetPhotoInterface() {
    // Arrêter la caméra si active
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    
    // Réinitialiser les éléments
    document.getElementById('camera-video').style.display = 'none';
    document.getElementById('start-camera-btn').style.display = 'block';
    document.getElementById('take-photo-btn').style.display = 'none';
    document.getElementById('retake-photo-btn').style.display = 'none';
    document.getElementById('photo-preview').style.display = 'none';
    document.getElementById('photo-actions').style.display = 'none';
    
    capturedPhotoBlob = null;
}

// Démarrer la caméra
async function startCamera() {
    try {
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'environment' // Caméra arrière par défaut
            }
        };
        
        cameraStream = await requestCameraBrowser();
        const video = document.getElementById('camera-video');
        video.srcObject = cameraStream;
        video.style.display = 'block';
        
        // Mettre à jour les boutons
        document.getElementById('start-camera-btn').style.display = 'none';
        document.getElementById('take-photo-btn').style.display = 'block';
        
        showNotification('📷 Caméra activée', 'success');
        
    } catch (error) {
        console.error('❌ Erreur accès caméra:', error);
        showNotification('❌ Impossible d\'accéder à la caméra', 'error');
    }
}

// Prendre une photo
function takePhoto() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('photo-canvas');
    const context = canvas.getContext('2d');
    
    // Définir la taille du canvas
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Dessiner l'image du video sur le canvas
    context.drawImage(video, 0, 0);
    
    // Convertir en blob avec compression
    canvas.toBlob((blob) => {
        compressPhoto(blob);
    }, 'image/jpeg', 0.8); // Qualité 80%
}

// Compresser la photo pour respecter la limite de 1MB
function compressPhoto(originalBlob) {
    const maxSize = 1024 * 1024; // 1MB
    let quality = 0.8;
    
    function compress(blob, currentQuality) {
        if (blob.size <= maxSize || currentQuality <= 0.1) {
            // Photo acceptable ou qualité minimale atteinte
            capturedPhotoBlob = blob;
            displayPhoto(blob);
            return;
        }
        
        // Réduire la qualité et recompresser
        const canvas = document.getElementById('photo-canvas');
        canvas.toBlob((newBlob) => {
            compress(newBlob, currentQuality - 0.1);
        }, 'image/jpeg', currentQuality - 0.1);
    }
    
    compress(originalBlob, quality);
}

// Afficher la photo capturée
function displayPhoto(blob) {
    const img = document.getElementById('captured-photo');
    const url = URL.createObjectURL(blob);
    img.src = url;
    
    // Afficher les infos
    const sizeKB = Math.round(blob.size / 1024);
    const quality = blob.size > 500000 ? 'Haute' : blob.size > 200000 ? 'Moyenne' : 'Optimisée';
    
    document.getElementById('photo-size').textContent = `${sizeKB} KB`;
    document.getElementById('photo-quality').textContent = quality;
    
    // Arrêter la caméra
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    
    // Mettre à jour l'interface
    document.getElementById('camera-video').style.display = 'none';
    document.getElementById('take-photo-btn').style.display = 'none';
    document.getElementById('retake-photo-btn').style.display = 'block';
    document.getElementById('photo-preview').style.display = 'block';
    document.getElementById('photo-actions').style.display = 'block';
    
    console.log('📸 Photo capturée:', sizeKB + 'KB');
}

// Reprendre une photo
function retakePhoto() {
    // Nettoyer l'ancienne photo
    if (capturedPhotoBlob) {
        URL.revokeObjectURL(document.getElementById('captured-photo').src);
        capturedPhotoBlob = null;
    }
    
    // Redémarrer la caméra
    startCamera();
    
    // Cacher la prévisualisation
    document.getElementById('photo-preview').style.display = 'none';
    document.getElementById('photo-actions').style.display = 'none';
    document.getElementById('retake-photo-btn').style.display = 'none';
}

// Envoyer la photo pour validation
async function submitPhoto() {
    console.log('🔍 [submitPhoto] Fonction appelée', {
        capturedPhotoBlob: !!capturedPhotoBlob,
        currentPhotoCheckpoint: currentPhotoCheckpoint?.name,
        currentTeamId: currentTeamId
    });
    
    if (!capturedPhotoBlob || !currentPhotoCheckpoint) {
        console.error('❌ [submitPhoto] Données manquantes:', {
            capturedPhotoBlob: !!capturedPhotoBlob,
            currentPhotoCheckpoint: !!currentPhotoCheckpoint
        });
        showNotification('❌ Aucune photo à envoyer', 'error');
        return;
    }
    
    try {
        console.log('🔄 [submitPhoto] Conversion blob en base64...');
        // Convertir le blob en base64
        const base64 = await blobToBase64(capturedPhotoBlob);
        console.log('✅ [submitPhoto] Conversion réussie, taille:', base64.length);
        
        // Créer la demande de validation avec la photo
        const validationData = {
            teamId: currentTeamId,
            checkpointId: currentPhotoCheckpoint.id,
            type: 'photo',
            data: {
                photo: base64,
                size: capturedPhotoBlob.size,
                timestamp: new Date().toISOString()
            },
            message: `Photo envoyée pour "${currentPhotoCheckpoint.name}"`
        };
        
        console.log('🔄 [submitPhoto] Envoi à Firebase...');
        await firebaseService.createValidationRequest(
            validationData.teamId,
            validationData.checkpointId,
            validationData.type,
            JSON.stringify(validationData.data)
        );
        console.log('✅ [submitPhoto] Envoi Firebase réussi');
        
        // Marquer le checkpoint comme en attente de validation
        pendingPhotoValidations.add(currentPhotoCheckpoint.id);
        console.log(`⏳ Photo ajoutée aux validations en attente pour: ${currentPhotoCheckpoint.name}`);
        
        // Fermer le modal
        document.getElementById('photo-modal').style.display = 'none';
        if (currentPhotoCheckpoint) {
            activeModals.delete(`photo-${currentPhotoCheckpoint.id}`);
        }
        resetPhotoInterface();
        
        showNotification(`📸 Photo envoyée pour validation de "${currentPhotoCheckpoint.name}"`, 'success');
        
        console.log('✅ [submitPhoto] Photo envoyée pour validation:', currentPhotoCheckpoint.name);
        
    } catch (error) {
        console.error('❌ [submitPhoto] Erreur envoi photo:', error);
        console.error('📊 [submitPhoto] Stack trace:', error.stack);
        showNotification('❌ Erreur lors de l\'envoi: ' + error.message, 'error');
    }
}

// Convertir un blob en base64
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ===== SYSTÈME DE NOTIFICATIONS =====

// Configurer les listeners pour les notifications de refus
function setupNotificationListeners() {
    console.log('🔔 [SETUP] setupNotificationListeners appelé', {
        firebaseService: !!firebaseService,
        currentTeamId: currentTeamId,
        alreadyConfigured: notificationListenersConfigured
    });
    
    if (!firebaseService || !currentTeamId) {
        console.warn('⚠️ Impossible de configurer les notifications - service non disponible');
        return;
    }
    
    // ✅ Nettoyer les anciens listeners s'ils existent
    if (helpRequestsListenerUnsubscribe) {
        console.log('🧹 Nettoyage ancien listener demandes aide');
        helpRequestsListenerUnsubscribe();
        helpRequestsListenerUnsubscribe = null;
    }
    if (validationsListenerUnsubscribe) {
        console.log('🧹 Nettoyage ancien listener validations');
        validationsListenerUnsubscribe();
        validationsListenerUnsubscribe = null;
    }
    
    notificationListenersConfigured = false; // Reset avant de reconfigurer
    
    // Écouter les demandes d'aide résolues
    console.log('🔔 [SETUP] Configuration listener demandes aide...');
    helpRequestsListenerUnsubscribe = firebaseService.onTeamHelpRequestsResolved(currentTeamId, (resolvedRequests) => {
        resolvedRequests.forEach(request => {
            // Éviter les doublons
            if (processedNotifications.has(request.id)) return;
            processedNotifications.add(request.id);
            
            if (request.action === 'denied') {
                showAdminRefusalNotification('aide', request);
            } else if (request.action === 'granted') {
                handleGrantedHelpRequest(request);
            }
        });
    });
    console.log('✅ [SETUP] Listener demandes aide configuré');
    
    // Écouter les validations résolues
    console.log('🔔 [SETUP] Configuration listener validations pour teamId:', currentTeamId);
    validationsListenerUnsubscribe = firebaseService.onTeamValidationsResolved(currentTeamId, (resolvedValidations) => {
        console.log(`🔔 [VALIDATIONS] Reçu ${resolvedValidations.length} validations:`, resolvedValidations.map(v => ({
            id: v.id,
            status: v.status,
            checkpointId: v.checkpointId
        })));
        
        // Créer un Set des checkpoints approuvés dans ce batch pour éviter d'afficher les rejets obsolètes
        const approvedCheckpoints = new Set(
            resolvedValidations
                .filter(v => v.status === 'approved')
                .map(v => v.checkpointId)
        );
        
        resolvedValidations.forEach(validation => {
            try {
                console.log(`🔵 [DEBUG] Début traitement validation ${validation.id} status=${validation.status} checkpointId=${validation.checkpointId}`);
                
                // ✅ UTILISER ID + STATUS pour permettre le retraitement si le statut change
                // (ex: une validation rejected puis approved doit être traitée 2 fois)
                const notificationKey = `${validation.id}_${validation.status}`;
                console.log(`🔵 [DEBUG] notificationKey créé: ${notificationKey}`);
                
                // Éviter les doublons pour cette combinaison ID + status
                if (processedNotifications.has(notificationKey)) {
                    console.log(`🔄 Validation ${validation.id} (${validation.status}) déjà traitée, ignorée`);
                    return;
                }
                processedNotifications.add(notificationKey);
                console.log(`🔵 [DEBUG] notificationKey ajouté au Set`);
                console.log(`🔵 [DEBUG] Ligne 5741 atteinte`);
                console.log(`🔵 [DEBUG] validation.id=${validation.id}`);
                console.log(`🔵 [DEBUG] validation.status=${validation.status}`);
                console.log(`🔵 [DEBUG] validation.checkpointId=${validation.checkpointId}`);
                
                console.log(`🆕 Traitement validation ${validation.id} (${validation.status}) pour checkpoint ${validation.checkpointId}`);
            
            if (validation.status === 'rejected') {
                // Ne pas afficher le rejet si :
                // 1. Le checkpoint a finalement été validé dans le même batch (après refresh)
                // 2. Le checkpoint est déjà dans foundCheckpoints (déjà validé avant)
                if (approvedCheckpoints.has(validation.checkpointId)) {
                    console.log(`ℹ️ Rejet ignoré - checkpoint ${validation.checkpointId} validé dans le même batch`);
                    return;
                }
                if (foundCheckpoints.includes(validation.checkpointId)) {
                    console.log(`ℹ️ Rejet ignoré - checkpoint ${validation.checkpointId} déjà validé`);
                    return;
                }
                
                showAdminRefusalNotification('validation', validation);
                // Retirer du Set des validations en attente pour permettre une nouvelle tentative
                pendingPhotoValidations.delete(validation.checkpointId);
                console.log(`❌ Photo rejetée - ${validation.checkpointId} retiré des validations en attente, vous pouvez réessayer`);
            } else if (validation.status === 'approved') {
                // Retirer du Set des validations en attente - photo validée
                pendingPhotoValidations.delete(validation.checkpointId);
                console.log(`✅ Photo approuvée - ${validation.checkpointId} retiré des validations en attente`);
                    
                    // ✅ MARQUER LE CHECKPOINT COMME COMPLÉTÉ
                    if (!foundCheckpoints.includes(validation.checkpointId)) {
                        foundCheckpoints.push(validation.checkpointId);
                        console.log(`✅ Checkpoint ${validation.checkpointId} ajouté à foundCheckpoints`);
                        
                        // ✅ METTRE À JOUR currentTeam IMMÉDIATEMENT pour que l'UI se mette à jour
                        if (currentTeam) {
                            if (!currentTeam.foundCheckpoints) currentTeam.foundCheckpoints = [];
                            if (!currentTeam.foundCheckpoints.includes(validation.checkpointId)) {
                                currentTeam.foundCheckpoints.push(validation.checkpointId);
                                console.log(`✅ Checkpoint ${validation.checkpointId} ajouté à currentTeam.foundCheckpoints`);
                            }
                            
                            // Débloquer le checkpoint suivant dans la route
                            const route = currentTeam.route || [];
                            console.log(`🔵 [DEBUG] route=`, route);
                            console.log(`🔵 [DEBUG] validation.checkpointId=${validation.checkpointId}`);
                            const currentIndex = route.indexOf(validation.checkpointId);
                            console.log(`🔵 [DEBUG] currentIndex dans route=${currentIndex}`);
                            if (currentIndex !== -1 && currentIndex < route.length - 1) {
                                const nextCheckpointId = route[currentIndex + 1];
                                console.log(`🔵 [DEBUG] nextCheckpointId=${nextCheckpointId}`);
                                if (!currentTeam.unlockedCheckpoints) currentTeam.unlockedCheckpoints = [0];
                                console.log(`🔵 [DEBUG] currentTeam.unlockedCheckpoints=`, currentTeam.unlockedCheckpoints);
                                if (!currentTeam.unlockedCheckpoints.includes(nextCheckpointId)) {
                                    currentTeam.unlockedCheckpoints.push(nextCheckpointId);
                                    unlockedCheckpoints.push(nextCheckpointId);
                                    console.log(`🔓 Checkpoint suivant ${nextCheckpointId} débloqué !`);
                                    
                                    // ✅ REDESSINER LES MARQUEURS SUR LA CARTE
                                    console.log(`🗺️ Mise à jour de la carte avec le nouveau checkpoint débloqué...`);
                                    addCheckpointsToMap();
                                } else {
                                    console.log(`ℹ️ Checkpoint suivant ${nextCheckpointId} déjà débloqué`);
                                }
                            } else {
                                console.log(`ℹ️ Pas de checkpoint suivant à débloquer (currentIndex=${currentIndex}, route.length=${route.length})`);
                            }
                        }
                        
                        // Sauvegarder immédiatement
                        forceSave('photo_validated').catch(err => {
                            console.error('❌ Erreur save après validation photo:', err);
                        });
                        
                        // Afficher notification de succès avec message personnalisé
                        const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === validation.checkpointId);
                        const successMsg = checkpoint?.clue?.successMessage || `🎉 Photo validée pour "${checkpoint?.name || validation.checkpointId}" !`;
                        showNotification(successMsg, 'success');
                        
                        // Fermer le modal photo s'il est ouvert
                        const photoModal = document.getElementById('photo-modal');
                        if (photoModal && photoModal.style.display !== 'none') {
                            console.log(`🔴 Fermeture du modal photo suite à validation admin`);
                            photoModal.style.display = 'none';
                            activeModals.delete(`photo-${validation.checkpointId}`);
                            dismissedModals.add(validation.checkpointId);
                            resetPhotoInterface();
                        }
                        
                        // Fermer le modal audio s'il est ouvert pour ce checkpoint
                        const audioModal = document.getElementById('audio-modal');
                        if (audioModal && audioModal.style.display !== 'none' && currentAudioCheckpoint?.id === validation.checkpointId) {
                            console.log(`🔴 Fermeture du modal audio suite à validation admin`);
                            audioModal.style.display = 'none';
                            activeModals.delete(validation.checkpointId);
                            dismissedModals.add(validation.checkpointId);
                            resetAudioInterface();
                        }
                        
                        // Mettre à jour l'interface
                        updatePlayerRouteProgress();
                    } else {
                        console.log(`ℹ️ Checkpoint ${validation.checkpointId} déjà dans foundCheckpoints`);
                    }
                }
            } catch (error) {
                console.error(`❌ [ERROR] Erreur traitement validation ${validation.id}:`, error);
                console.error(`❌ [ERROR] Stack:`, error.stack);
            }
        });
    });
    
    notificationListenersConfigured = true; // Marquer comme configuré
    console.log('✅ [SETUP] Listener validations configuré avec succès');
}

// ✅ VÉRIFIER ET CONFIGURER LES LISTENERS AUTOMATIQUEMENT
function ensureNotificationListenersAreActive() {
    if (!notificationListenersConfigured && firebaseService && currentTeamId) {
        console.log('🔧 Auto-configuration des listeners de notifications...');
        setupNotificationListeners();
    }
}

// ✅ VÉRIFIER PÉRIODIQUEMENT QUE LES LISTENERS SONT ACTIFS
setInterval(() => {
    ensureNotificationListenersAreActive();
}, 5000); // Toutes les 5 secondes

// Traiter une demande d'aide accordée par l'admin
function handleGrantedHelpRequest(request) {
    const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === request.checkpointId);
    const checkpointName = checkpoint ? checkpoint.name : `Point ${request.checkpointId}`;
    
    console.log('✅ Demande d\'aide accordée par admin:', {
        type: request.type,
        checkpointId: request.checkpointId,
        checkpointName: checkpointName
    });
    
    // Traitement selon le type d'aide accordée
    if (request.type === 'audio') {
        // Pour les épreuves audio : marquer comme trouvé et débloquer le suivant
        if (!foundCheckpoints.includes(request.checkpointId)) {
            foundCheckpoints.push(request.checkpointId);
            
            // Mettre à jour le marqueur visuellement
            const markerData = checkpointMarkers.find(m => m.id === request.checkpointId);
            if (markerData) {
                const newIcon = L.divIcon({
                    className: 'checkpoint-marker found',
                    html: checkpoint.emoji,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                });
                markerData.marker.setIcon(newIcon);
                
                // Mettre à jour le cercle en vert
                markerData.circle.setStyle({
                    color: '#27ae60',
                    fillColor: '#27ae60'
                });
            }
            
            // Débloquer le prochain checkpoint
            const nextCheckpointId = getNextCheckpointForTeam();
            if (nextCheckpointId) {
                unlockCheckpoint(nextCheckpointId);
                
                const nextCheckpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === nextCheckpointId);
                const nextName = nextCheckpoint ? nextCheckpoint.name : 'prochain point';
                showNotification(`✅ Admin a validé l'épreuve audio "${checkpointName}" ! "${nextName}" est débloqué.`, 'success');
            } else {
                showNotification(`✅ Admin a validé l'épreuve audio "${checkpointName}" ! Parcours terminé !`, 'success');
            }
            
            // Sauvegarder la progression
            if (firebaseService && currentTeam && currentTeamId) {
                firebaseService.updateTeamProgress(currentTeamId, {
                    foundCheckpoints: foundCheckpoints,
                    unlockedCheckpoints: unlockedCheckpoints
                });
            }
            
            // Mettre à jour l'interface
            updateUI();
            
            // Fermer le modal audio s'il est ouvert
            const audioModal = document.getElementById('audio-modal');
            if (audioModal && audioModal.style.display !== 'none') {
                audioModal.style.display = 'none';
                resetAudioInterface();
            }
        }
    } else if (request.type === 'qcm') {
        // Pour les QCM : marquer comme trouvé et débloquer le suivant
        if (!foundCheckpoints.includes(request.checkpointId)) {
            foundCheckpoints.push(request.checkpointId);
            
            // Mettre à jour le marqueur visuellement
            const markerData = checkpointMarkers.find(m => m.id === request.checkpointId);
            if (markerData) {
                const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === request.checkpointId);
                const newIcon = L.divIcon({
                    className: 'checkpoint-marker found',
                    html: checkpoint?.emoji || '📍',
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                });
                markerData.marker.setIcon(newIcon);
                
                // Mettre à jour le cercle en vert
                markerData.circle.setStyle({
                    color: '#27ae60',
                    fillColor: '#27ae60'
                });
            }
            
            // Débloquer le prochain checkpoint
            const nextCheckpointId = getNextCheckpointForTeam();
            if (nextCheckpointId) {
                unlockCheckpoint(nextCheckpointId);
                
                const nextCheckpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === nextCheckpointId);
                const nextName = nextCheckpoint ? nextCheckpoint.name : 'prochain point';
                showNotification(`🎉 "${nextName}" est maintenant débloqué !`);
                
                // Zoomer sur le nouveau point débloqué
                if (nextCheckpoint) {
                    console.log('🎯 Zoom vers le checkpoint débloqué:', nextCheckpoint.name);
                    centerMapOnCheckpoint(nextCheckpoint);
                }
            } else {
                showNotification('🏆 Parcours terminé ! Félicitations !');
            }
            
            // Sauvegarder la progression dans Firebase
            if (firebaseService && currentTeam && currentTeamId) {
                firebaseService.updateTeamProgress(currentTeamId, {
                    foundCheckpoints: foundCheckpoints,
                    unlockedCheckpoints: unlockedCheckpoints
                });
                
                console.log('💾 Progression QCM sauvegardée:', {
                    teamId: currentTeamId,
                    foundCheckpoints, 
                    unlockedCheckpoints
                });
            }
            
            // Mettre à jour l'interface
            updateUI();
            
            // Fermer le modal QCM s'il est ouvert
            if (document.getElementById('qcm-modal').style.display === 'flex') {
                document.getElementById('qcm-modal').style.display = 'none';
            }
        }
    } else if (request.type === 'location') {
        // Pour l'aide de localisation : juste une notification
        showNotification(`📍 Admin a fourni l'aide de localisation pour "${checkpointName}"`, 'success');
    } else if (request.type === 'riddle') {
        // Pour l'aide d'énigme : marquer comme trouvé et débloquer le suivant
        if (!foundCheckpoints.includes(request.checkpointId)) {
            foundCheckpoints.push(request.checkpointId);
            
            // Débloquer le prochain checkpoint
            const nextCheckpointId = getNextCheckpointForTeam();
            if (nextCheckpointId) {
                unlockCheckpoint(nextCheckpointId);
                
                const nextCheckpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === nextCheckpointId);
                const nextName = nextCheckpoint ? nextCheckpoint.name : 'prochain point';
                showNotification(`✅ Admin a résolu l'énigme "${checkpointName}" ! "${nextName}" est débloqué.`, 'success');
            } else {
                showNotification(`✅ Admin a résolu l'énigme "${checkpointName}" ! Parcours terminé !`, 'success');
            }
            
            // Sauvegarder la progression
            if (firebaseService && currentTeam && currentTeamId) {
                firebaseService.updateTeamProgress(currentTeamId, {
                    foundCheckpoints: foundCheckpoints,
                    unlockedCheckpoints: unlockedCheckpoints
                });
            }
            
            // Mettre à jour l'interface
            updateUI();
            
            // Fermer le modal énigme s'il est ouvert
            const riddleModal = document.getElementById('riddle-modal');
            if (riddleModal && riddleModal.style.display !== 'none') {
                riddleModal.style.display = 'none';
            }
        }
    }
}

// Afficher une notification de refus admin
function showAdminRefusalNotification(type, data) {
    const checkpoint = GAME_CONFIG.checkpoints.find(cp => cp.id === data.checkpointId);
    const checkpointName = checkpoint ? checkpoint.name : `Point ${data.checkpointId}`;
    
    let title, message;
    
    if (type === 'aide') {
                const helpType = data.type === 'location' ? 'localisation' : 
                                data.type === 'riddle' ? 'énigme' : 
                                data.type === 'audio' ? 'épreuve audio' :
                                data.type === 'qcm' ? 'QCM' :
                                data.type === 'photo' ? 'validation photo' : 'aide';
        title = `❌ Demande d'aide refusée`;
        message = `Votre demande d'aide (${helpType}) pour "${checkpointName}" a été refusée par l'admin.`;
    } else {
        title = `❌ Validation refusée`;
        message = `Votre validation pour "${checkpointName}" a été refusée par l'admin.`;
    }
    
    if (data.adminNotes) {
        message += `\n\n💬 Note de l'admin : "${data.adminNotes}"`;
    }
    
    // Vérifier si c'est une photo refusée pour ajouter le bouton reprendre
    const isPhotoRefusal = (type === 'validation' && checkpoint?.type === 'photo') || 
                          (type === 'aide' && data.type === 'photo');
    
    // Afficher une notification persistante avec bouton reprendre si c'est une photo
    showPersistentNotification(title, message, isPhotoRefusal ? checkpoint : null);
}

// Notification persistante avec bouton OK (et bouton reprendre photo si applicable)
function showPersistentNotification(title, message, photoCheckpoint = null) {
    // Créer le modal de notification
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    
    // Boutons selon le contexte
    let buttonsHTML = '';
    if (photoCheckpoint) {
        // Photo refusée → boutons Reprendre + OK
        buttonsHTML = `
            <div style="display: flex; gap: 0.5rem; width: 100%;">
                <button id="notification-retry-btn" class="photo-btn success" style="flex: 1;">📸 Reprendre photo</button>
                <button id="notification-ok-btn" class="photo-btn" style="flex: 1;">OK</button>
            </div>
        `;
    } else {
        // Notification normale → juste OK
        buttonsHTML = `<button id="notification-ok-btn" class="photo-btn" style="width: 100%;">OK</button>`;
    }
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <h2 style="color: #e74c3c; margin-bottom: 1rem;">${title}</h2>
            <p style="white-space: pre-line; margin-bottom: 1.5rem;">${message}</p>
            ${buttonsHTML}
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Gérer la fermeture
    const okBtn = modal.querySelector('#notification-ok-btn');
    okBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Gérer le bouton reprendre photo
    if (photoCheckpoint) {
        const retryBtn = modal.querySelector('#notification-retry-btn');
        retryBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
            // Relancer le défi photo
            showPhotoChallenge(photoCheckpoint);
            console.log(`📸 Reprise du défi photo pour: ${photoCheckpoint.name}`);
        });
    }
    
    // Auto-suppression après 30 secondes
    setTimeout(() => {
        if (document.body.contains(modal)) {
            document.body.removeChild(modal);
        }
    }, 30000);
}

// Anciennes fonctions d'aide supprimées - remplacées par les fonctions spécifiques par checkpoint

// ===== SYSTÈME D'AUTO-SAVE INTELLIGENT =====

/**
 * Obtenir l'état actuel du jeu pour sauvegarde
 */
function getCurrentGameState() {
    return {
        teamId: currentTeamId,
        foundCheckpoints: [...foundCheckpoints],
        unlockedCheckpoints: [...unlockedCheckpoints],
        lastPosition: userPosition ? {
            lat: Math.round(userPosition.lat * 10000) / 10000, // Arrondir à 4 décimales
            lng: Math.round(userPosition.lng * 10000) / 10000,
            accuracy: userPosition.accuracy
        } : null,
        gpsLockState: {
            isLocked: gpsLockState.isLocked,
            lockReason: gpsLockState.lockReason
        },
        timestamp: Date.now()
    };
}

/**
 * Vérifier si l'état a changé depuis la dernière sauvegarde
 */
function hasGameStateChanged() {
    const currentState = getCurrentGameState();
    
    if (!lastSavedState) return true;
    
    // Comparer les états (ignorer timestamp)
    const current = JSON.stringify({
        ...currentState,
        timestamp: 0
    });
    const last = JSON.stringify({
        ...lastSavedState,
        timestamp: 0
    });
    
    return current !== last;
}

/**
 * Sauvegarde hybride : Firebase + localStorage
 */
async function hybridSave(state, reason = 'auto') {
    const saveStart = Date.now();
    let success = false;
    let error = null;
    
    try {
        // 1. Sauvegarder dans localStorage (instantané)
        try {
            const localData = {
                ...state,
                savedAt: saveStart,
                reason: reason
            };
            localStorage.setItem('gameState', JSON.stringify(localData));
            localStorage.setItem('gameState_backup', JSON.stringify(localData)); // Double backup
        } catch (localError) {
            console.warn('⚠️ Erreur localStorage:', localError);
        }
        
        // 2. Sauvegarder dans Firebase (sync)
        if (firebaseService && state.teamId) {
            await firebaseService.updateTeamProgress(state.teamId, {
                foundCheckpoints: state.foundCheckpoints,
                unlockedCheckpoints: state.unlockedCheckpoints,
                lastPosition: state.lastPosition,
                lastSaveReason: reason,
                updatedAt: new Date()
            });
        }
        
        success = true;
        saveMetrics.totalSaves++;
        lastSaveTime = Date.now();
        lastSavedState = state;
        
        // Ajouter à l'historique
        addToSaveHistory({
            timestamp: saveStart,
            duration: Date.now() - saveStart,
            reason: reason,
            success: true,
            checkpointsCount: state.foundCheckpoints.length
        });
        
    } catch (err) {
        error = err;
        saveMetrics.failedSaves++;
        saveMetrics.lastError = err.message;
        
        addToSaveHistory({
            timestamp: saveStart,
            duration: Date.now() - saveStart,
            reason: reason,
            success: false,
            error: err.message
        });
        
        console.error('❌ Erreur sauvegarde hybride:', err);
    }
    
    return { success, error };
}

/**
 * Ajouter une entrée à l'historique des sauvegardes
 */
function addToSaveHistory(entry) {
    saveHistory.unshift(entry);
    
    // Limiter la taille de l'historique
    if (saveHistory.length > MAX_SAVE_HISTORY) {
        saveHistory = saveHistory.slice(0, MAX_SAVE_HISTORY);
    }
    
    // Mettre à jour le debug panel si ouvert
    if (document.getElementById('debug-panel-modal')?.style.display === 'flex') {
        updateDebugPanel();
    }
}

/**
 * Fonction d'auto-save appelée périodiquement
 */
async function autoSaveGameState() {
    if (!currentTeam || !currentTeamId) {
        return; // Pas d'équipe connectée
    }
    
    // Vérifier si l'état a changé
    if (!hasGameStateChanged()) {
        saveMetrics.skippedSaves++;
        console.log('⏭️ Auto-save skipped (no changes)');
        return;
    }
    
    console.log('💾 Auto-save triggered...');
    const state = getCurrentGameState();
    await hybridSave(state, 'auto');
}

/**
 * Démarrer l'auto-save
 */
function startAutoSave() {
    if (autoSaveInterval) {
        console.log('ℹ️ Auto-save déjà actif');
        return;
    }
    
    console.log(`🔄 Démarrage auto-save (interval: ${AUTO_SAVE_INTERVAL}ms)`);
    
    // Première sauvegarde immédiate
    autoSaveGameState();
    
    // Puis sauvegardes périodiques
    autoSaveInterval = setInterval(autoSaveGameState, AUTO_SAVE_INTERVAL);
    isAutoSaveActive = true;
}

/**
 * Arrêter l'auto-save
 */
function stopAutoSave() {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
        autoSaveInterval = null;
        isAutoSaveActive = false;
        console.log('⏸️ Auto-save arrêté');
    }
}

/**
 * Force save immédiate (utilisé pour visibilitychange, etc.)
 */
async function forceSave(reason = 'force') {
    if (!currentTeam || !currentTeamId) return;
    
    console.log(`💾 Force save (reason: ${reason})`);
    const state = getCurrentGameState();
    return await hybridSave(state, reason);
}

/**
 * Charger l'état depuis localStorage (recovery rapide)
 */
function loadFromLocalStorage() {
    try {
        const saved = localStorage.getItem('gameState');
        if (saved) {
            const data = JSON.parse(saved);
            
            // Vérifier que les données sont récentes (< 1 heure)
            const age = Date.now() - data.savedAt;
            if (age < 3600000) { // 1 heure
                console.log('📂 Données localStorage trouvées:', {
                    age: Math.round(age / 1000) + 's',
                    checkpoints: data.foundCheckpoints?.length || 0
                });
                return data;
            } else {
                console.log('⚠️ Données localStorage trop anciennes');
            }
        }
    } catch (error) {
        console.warn('⚠️ Erreur chargement localStorage:', error);
    }
    return null;
}

/**
 * Gestion améliorée du visibilitychange + interaction
 */
let lastInteractionResume = 0; // Throttling pour éviter les relances multiples
let hasResumedSinceVisible = false; // Flag pour savoir si on a déjà repris depuis la dernière visibilité

function setupEnhancedVisibilityHandler() {
    // ===== EVENT: VISIBILITYCHANGE =====
    document.addEventListener('visibilitychange', async () => {
        if (document.hidden) {
            // Page cachée/mise en arrière-plan
            console.log('👋 App mise en arrière-plan');
            
            // Sauvegarder immédiatement
            await forceSave('visibility_hidden');
            
            // Pause GPS pour économiser la batterie
            pauseGPS();
            
            // Réinitialiser le flag de reprise
            hasResumedSinceVisible = false;
            
        } else {
            // Page redevient visible
            console.log('👀 App revenue au premier plan');
            
            // Reprendre GPS immédiatement
            resumeGPS();
            hasResumedSinceVisible = true;
            
            // Recharger l'état depuis Firebase
            if (currentTeamId && firebaseService) {
                try {
                    const teamData = await firebaseService.getTeam(currentTeamId);
                    if (teamData) {
                        // Appliquer les changements distants
                        const hadChanges = syncRemoteChanges(teamData);
                        if (hadChanges) {
                            showNotification('🔄 Progression synchronisée !', 'info');
                        }
                    }
                } catch (error) {
                    console.error('❌ Erreur sync au retour:', error);
                }
            }
        }
    });
    
    // ===== EVENT: FOCUS DE LA FENÊTRE =====
    // Redémarrer le GPS si la fenêtre récupère le focus
    window.addEventListener('focus', () => {
        if (!document.hidden && !hasResumedSinceVisible && isGameStarted) {
            console.log('🔍 Fenêtre a le focus - tentative reprise GPS');
            resumeGPS();
            hasResumedSinceVisible = true;
        }
    });
    
    // ===== EVENT: INTERACTION UTILISATEUR =====
    // Détecter le premier touch/click après le déverrouillage pour relancer le GPS si besoin
    const interactionHandler = (event) => {
        // ⚠️ NE PAS INTERFERER avec les clics sur les boutons, modals, etc.
        // Seulement détecter les interactions générales avec la page
        const target = event.target;
        if (target && (
            target.tagName === 'BUTTON' || 
            target.tagName === 'A' ||
            target.tagName === 'INPUT' ||
            target.closest('button') ||
            target.closest('.modal') ||
            target.closest('.photo-btn')
        )) {
            // C'est un clic intentionnel sur un élément interactif, on ignore
            return;
        }
        
        const now = Date.now();
        
        // Throttling: minimum 3 secondes entre les tentatives
        if (now - lastInteractionResume < 3000) {
            return;
        }
        
        // Si on est visible, le jeu est démarré, mais qu'on n'a pas de watchID actif
        if (!document.hidden && isGameStarted && gpsWatchId === null) {
            console.log('👆 Interaction détectée - relance GPS après verrouillage');
            resumeGPS();
            lastInteractionResume = now;
            hasResumedSinceVisible = true;
            
            // Sauvegarder aussi pour être sûr
            forceSave('interaction_resume').catch(err => {
                console.error('❌ Erreur save après interaction:', err);
            });
        }
    };
    
    // Écouter touch et click sur le document
    // Note: On garde passive: true car on ne modifie pas le comportement par défaut
    document.addEventListener('touchstart', interactionHandler, { passive: true });
    document.addEventListener('click', interactionHandler, { passive: true });
    
    console.log('✅ Enhanced visibilitychange + interaction handler installé');
}

/**
 * Synchroniser les changements distants (depuis Firebase)
 */
function syncRemoteChanges(remoteData) {
    let hasChanges = false;
    
    // Vérifier foundCheckpoints
    const remoteFound = remoteData.foundCheckpoints || [];
    const localFound = foundCheckpoints || [];
    
    const newCheckpoints = remoteFound.filter(id => !localFound.includes(id));
    if (newCheckpoints.length > 0) {
        foundCheckpoints = [...remoteFound];
        hasChanges = true;
        console.log('🔄 Nouveaux checkpoints distants:', newCheckpoints);
    }
    
    // Vérifier unlockedCheckpoints
    const remoteUnlocked = remoteData.unlockedCheckpoints || [0];
    const localUnlocked = unlockedCheckpoints || [0];
    
    const newUnlocked = remoteUnlocked.filter(id => !localUnlocked.includes(id));
    if (newUnlocked.length > 0) {
        unlockedCheckpoints = [...remoteUnlocked];
        hasChanges = true;
        console.log('🔓 Nouveaux checkpoints débloqués:', newUnlocked);
    }
    
    if (hasChanges) {
        updateUI();
        updateProgress();
        updatePlayerRouteProgress();
    }
    
    return hasChanges;
}

/**
 * Pause GPS (économie batterie)
 */
function pauseGPS() {
    if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null; // Réinitialiser l'ID pour permettre la reprise
        console.log('⏸️ GPS mis en pause');
    }
}

/**
 * Reprendre GPS
 */
function resumeGPS() {
    if (gpsWatchId === null && isGameStarted) {
        requestGeolocation();
        console.log('▶️ GPS repris');
    }
}

// ===== DEBUG PANEL =====

/**
 * Afficher le panneau de debug
 */
function showDebugPanel() {
    let modal = document.getElementById('debug-panel-modal');
    
    if (!modal) {
        // Créer le modal de debug
        modal = document.createElement('div');
        modal.id = 'debug-panel-modal';
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content debug-panel-content">
                <div class="debug-panel-header">
                    <h2>🔧 Debug Panel</h2>
                    <button class="debug-close-btn" onclick="closeDebugPanel()">✖</button>
                </div>
                <div id="debug-panel-body">
                    <p>Chargement...</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    } else {
        modal.style.display = 'flex';
    }
    
    updateDebugPanel();
}

/**
 * Fermer le panneau de debug
 */
function closeDebugPanel() {
    const modal = document.getElementById('debug-panel-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Mettre à jour le contenu du debug panel
 */
function updateDebugPanel() {
    const body = document.getElementById('debug-panel-body');
    if (!body) return;
    
    const now = Date.now();
    const timeSinceLastSave = lastSaveTime ? Math.round((now - lastSaveTime) / 1000) : '∞';
    const currentState = getCurrentGameState();
    
    // Calculer les stats
    const successRate = saveMetrics.totalSaves > 0 
        ? Math.round((saveMetrics.totalSaves / (saveMetrics.totalSaves + saveMetrics.failedSaves)) * 100)
        : 100;
    
    body.innerHTML = `
        <div class="debug-section">
            <h3>📊 État Actuel</h3>
            <div class="debug-info">
                <div class="debug-row">
                    <span>Dernière save:</span>
                    <span class="${lastSaveTime ? 'success' : 'error'}">${timeSinceLastSave}s ago</span>
                </div>
                <div class="debug-row">
                    <span>Checkpoints trouvés:</span>
                    <span>${currentState.foundCheckpoints.length}</span>
                </div>
                <div class="debug-row">
                    <span>Checkpoints débloqués:</span>
                    <span>${currentState.unlockedCheckpoints.length}</span>
                </div>
                <div class="debug-row">
                    <span>Position GPS:</span>
                    <span>${currentState.lastPosition ? `${currentState.lastPosition.lat.toFixed(4)}, ${currentState.lastPosition.lng.toFixed(4)}` : 'N/A'}</span>
                </div>
                <div class="debug-row">
                    <span>GPS Lock:</span>
                    <span class="${currentState.gpsLockState.isLocked ? 'error' : 'success'}">${currentState.gpsLockState.isLocked ? '🔒 Verrouillé' : '🔓 OK'}</span>
                </div>
                <div class="debug-row">
                    <span>Auto-save:</span>
                    <span class="${isAutoSaveActive ? 'success' : 'error'}">${isAutoSaveActive ? '✅ Actif' : '❌ Inactif'}</span>
                </div>
            </div>
        </div>
        
        <div class="debug-section">
            <h3>📈 Métriques</h3>
            <div class="debug-info">
                <div class="debug-row">
                    <span>Total saves:</span>
                    <span>${saveMetrics.totalSaves}</span>
                </div>
                <div class="debug-row">
                    <span>Saves skipped (throttling):</span>
                    <span>${saveMetrics.skippedSaves}</span>
                </div>
                <div class="debug-row">
                    <span>Saves failed:</span>
                    <span class="${saveMetrics.failedSaves > 0 ? 'error' : 'success'}">${saveMetrics.failedSaves}</span>
                </div>
                <div class="debug-row">
                    <span>Success rate:</span>
                    <span class="${successRate >= 90 ? 'success' : 'warning'}">${successRate}%</span>
                </div>
                <div class="debug-row">
                    <span>Dernier sync Firebase:</span>
                    <span>${lastFirebaseUpdate ? Math.round((now - lastFirebaseUpdate) / 1000) + 's ago' : 'N/A'}</span>
                </div>
            </div>
        </div>
        
        <div class="debug-section">
            <h3>💾 Historique Saves (10 dernières)</h3>
            <div class="debug-history">
                ${saveHistory.slice(0, 10).map(entry => {
                    const time = new Date(entry.timestamp).toLocaleTimeString();
                    const icon = entry.success ? '✅' : '❌';
                    const status = entry.success 
                        ? `${entry.duration}ms - ${entry.checkpointsCount} CPs`
                        : entry.error;
                    return `
                        <div class="debug-history-entry ${entry.success ? 'success' : 'error'}">
                            <span>${icon} [${time}]</span>
                            <span>${entry.reason}</span>
                            <span>${status}</span>
                        </div>
                    `;
                }).join('') || '<p style="text-align: center; color: #666;">Aucune sauvegarde</p>'}
            </div>
        </div>
        
        <div class="debug-section">
            <h3>🔄 Actions</h3>
            <div class="debug-actions">
                <button onclick="forceSave('manual').then(() => { showNotification('✅ Save manuelle OK', 'success'); updateDebugPanel(); })" class="debug-btn primary">
                    💾 Force Save Now
                </button>
                <button onclick="loadFromFirebase()" class="debug-btn">
                    ☁️ Reload from Firebase
                </button>
                <button onclick="showLocalStorageBackup()" class="debug-btn">
                    📂 View localStorage
                </button>
                <button onclick="exportDebugData()" class="debug-btn">
                    📊 Export Debug Data
                </button>
            </div>
        </div>
        
        ${saveMetrics.lastError ? `
        <div class="debug-section error">
            <h3>⚠️ Dernière Erreur</h3>
            <pre>${saveMetrics.lastError}</pre>
        </div>
        ` : ''}
    `;
}

/**
 * Recharger depuis Firebase
 */
async function loadFromFirebase() {
    if (!currentTeamId || !firebaseService) {
        showNotification('❌ Pas de connexion Firebase', 'error');
        return;
    }
    
    try {
        showNotification('🔄 Chargement depuis Firebase...', 'info');
        const teamData = await firebaseService.getTeam(currentTeamId);
        
        if (teamData) {
            syncRemoteChanges(teamData);
            showNotification('✅ Données Firebase chargées !', 'success');
            updateDebugPanel();
        } else {
            showNotification('❌ Équipe non trouvée', 'error');
        }
    } catch (error) {
        showNotification('❌ Erreur chargement: ' + error.message, 'error');
    }
}

/**
 * Afficher le backup localStorage
 */
function showLocalStorageBackup() {
    const data = loadFromLocalStorage();
    if (data) {
        const age = Math.round((Date.now() - data.savedAt) / 1000);
        alert(`📂 Backup localStorage:\n\n` +
              `Age: ${age}s\n` +
              `Checkpoints trouvés: ${data.foundCheckpoints?.length || 0}\n` +
              `Checkpoints débloqués: ${data.unlockedCheckpoints?.length || 0}\n` +
              `Position: ${data.lastPosition ? 'Oui' : 'Non'}\n` +
              `Reason: ${data.reason || 'N/A'}`);
    } else {
        alert('📂 Aucun backup localStorage trouvé');
    }
}

/**
 * Exporter les données de debug
 */
function exportDebugData() {
    const data = {
        currentState: getCurrentGameState(),
        metrics: saveMetrics,
        history: saveHistory,
        team: {
            id: currentTeamId,
            name: currentTeam?.name
        },
        timestamp: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-${currentTeam?.name || 'unknown'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showNotification('📊 Données debug exportées !', 'success');
}

// Exposer les fonctions pour le HTML
window.showDebugPanel = showDebugPanel;
window.closeDebugPanel = closeDebugPanel;
window.forceSave = forceSave;
window.loadFromFirebase = loadFromFirebase;
window.showLocalStorageBackup = showLocalStorageBackup;
window.exportDebugData = exportDebugData;

// ===== MENU MOBILE =====

/**
 * Synchroniser les données desktop vers mobile
 * Cette fonction copie toutes les infos affichées dans le header et info-panel 
 * vers les éléments mobiles correspondants
 */
function syncDesktopToMobile() {
    // Synchroniser le statut
    const desktopStatus = document.getElementById('status');
    const mobileStatus = document.getElementById('mobile-status');
    if (desktopStatus && mobileStatus) {
        mobileStatus.textContent = desktopStatus.textContent;
    }
    
    // Synchroniser le nom d'équipe
    const desktopTeamName = document.getElementById('current-team');
    const mobileTeamName = document.getElementById('mobile-team-name');
    if (desktopTeamName && mobileTeamName) {
        mobileTeamName.textContent = desktopTeamName.textContent;
        // Afficher la section team info mobile si l'équipe est connectée
        const mobileTeamInfo = document.getElementById('mobile-team-info');
        if (mobileTeamInfo) {
            mobileTeamInfo.style.display = desktopTeamName.textContent ? 'block' : 'none';
        }
        
        // Afficher les boutons Debug/Health/Admin si l'équipe est connectée
        const mobileActions = document.querySelector('.mobile-actions');
        if (mobileActions) {
            mobileActions.style.display = desktopTeamName.textContent ? 'flex' : 'none';
        }
    }
    
    // Synchroniser la progression
    const desktopProgressFill = document.getElementById('progress-fill');
    const mobileProgressFill = document.getElementById('mobile-progress-fill');
    if (desktopProgressFill && mobileProgressFill) {
        const width = desktopProgressFill.style.width || '0%';
        mobileProgressFill.style.width = width;
    }
    
    const desktopProgressText = document.getElementById('progress-text');
    const mobileProgressText = document.getElementById('mobile-progress-text');
    if (desktopProgressText && mobileProgressText) {
        mobileProgressText.textContent = desktopProgressText.textContent;
    }
    
    // Synchroniser le parcours
    const desktopRouteList = document.getElementById('player-route-list');
    const mobileRouteList = document.getElementById('mobile-route-list');
    if (desktopRouteList && mobileRouteList) {
        mobileRouteList.innerHTML = desktopRouteList.innerHTML;
    }
    
    // Synchroniser le prochain objectif
    const desktopHintText = document.getElementById('hint-text');
    const mobileHintText = document.getElementById('mobile-hint-text');
    if (desktopHintText && mobileHintText) {
        mobileHintText.textContent = desktopHintText.textContent;
    }
    
    // Synchroniser le bouton GPS
    const desktopGpsBtn = document.getElementById('gps-route-btn');
    const mobileGpsBtn = document.getElementById('mobile-gps-route-btn');
    if (desktopGpsBtn && mobileGpsBtn) {
        mobileGpsBtn.style.display = desktopGpsBtn.style.display;
    }
}

/**
 * Ouvrir le menu mobile
 */
function openMobileMenu() {
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) {
        // Synchroniser les données avant d'ouvrir
        syncDesktopToMobile();
        
        // Ouvrir le menu avec animation
        mobileMenu.classList.add('open');
        
        // Empêcher le scroll de la carte en arrière-plan
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Fermer le menu mobile
 */
function closeMobileMenu() {
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) {
        mobileMenu.classList.remove('open');
        
        // Réactiver le scroll
        document.body.style.overflow = '';
    }
}

/**
 * Initialiser le menu mobile
 */
function initMobileMenu() {
    console.log('📱 Initialisation menu mobile...');
    
    // Bouton pour ouvrir le menu
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', openMobileMenu);
    }
    
    // Bouton pour fermer le menu
    const mobileMenuClose = document.getElementById('mobile-menu-close');
    if (mobileMenuClose) {
        mobileMenuClose.addEventListener('click', closeMobileMenu);
    }
    
    // Bouton GPS mobile (rediriger vers la fonction existante)
    const mobileGpsBtn = document.getElementById('mobile-gps-route-btn');
    if (mobileGpsBtn) {
        mobileGpsBtn.addEventListener('click', () => {
            // FERMER le menu (action qui lance la navigation)
            closeMobileMenu();
            // Déclencher le calcul GPS (même logique que le bouton desktop)
            const desktopGpsBtn = document.getElementById('gps-route-btn');
            if (desktopGpsBtn) {
                desktopGpsBtn.click();
            }
        });
    }
    
    // Bouton déconnexion mobile
    const mobileDisconnectBtn = document.getElementById('mobile-disconnect-btn');
    if (mobileDisconnectBtn) {
        mobileDisconnectBtn.addEventListener('click', () => {
            // FERMER le menu (action qui modifie l'état de l'app)
            closeMobileMenu();
            // Déclencher la déconnexion (même logique que le bouton desktop)
            const desktopDisconnectBtn = document.getElementById('disconnect-btn');
            if (desktopDisconnectBtn) {
                desktopDisconnectBtn.click();
            }
        });
    }
    
    // Bouton Outils Debug mobile (affiche le menu debug unifié complet)
    const mobileDebugPanelBtn = document.getElementById('mobile-debug-panel-btn');
    if (mobileDebugPanelBtn) {
        mobileDebugPanelBtn.addEventListener('click', () => {
            // NE PAS fermer le menu (on veut voir le menu debug par dessus)
            if (window.showUnifiedDebugMenu) {
                window.showUnifiedDebugMenu();
            }
        });
    }
    
    // Bouton Métriques mobile
    const mobileMetricsBtn = document.getElementById('mobile-metrics-btn');
    if (mobileMetricsBtn) {
        mobileMetricsBtn.addEventListener('click', () => {
            // NE PAS fermer le menu (on veut voir les métriques)
            if (window.showMetrics) {
                window.showMetrics();
            }
        });
    }
    
    // Bouton Health Check mobile
    const mobileHealthBtn = document.getElementById('mobile-health-btn');
    if (mobileHealthBtn) {
        mobileHealthBtn.addEventListener('click', () => {
            // NE PAS fermer le menu (on veut voir les résultats)
            if (window.healthCheck) {
                window.healthCheck();
            }
        });
    }
    
    // Observer les changements dans les éléments desktop pour les synchroniser en temps réel
    const observeElement = (desktopId, callback) => {
        const element = document.getElementById(desktopId);
        if (element) {
            const observer = new MutationObserver(() => {
                if (window.innerWidth <= 768) {
                    syncDesktopToMobile();
                }
            });
            observer.observe(element, { 
                childList: true, 
                subtree: true, 
                characterData: true,
                attributes: true,
                attributeFilter: ['style']
            });
        }
    };
    
    // Observer les changements pour synchronisation auto
    observeElement('status');
    observeElement('current-team');
    observeElement('progress-fill');
    observeElement('progress-text');
    observeElement('player-route-list');
    observeElement('hint-text');
    observeElement('gps-route-btn');
    
    // Synchroniser initialement
    syncDesktopToMobile();
    
    // Synchroniser à chaque redimensionnement (au cas où)
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (window.innerWidth <= 768) {
                syncDesktopToMobile();
            }
        }, 250);
    });
    
    // === WAKE LOCK (Garder l'écran allumé) ===
    const wakeLockToggle = document.getElementById('wake-lock-toggle');
    const wakeLockStatus = document.getElementById('wake-lock-status');
    
    if (wakeLockToggle && wakeLockStatus) {
        // Charger la préférence sauvegardée
        const wakeLockEnabled = localStorage.getItem('wakeLockEnabled') === 'true';
        wakeLockToggle.checked = wakeLockEnabled;
        
        // Activer si déjà enabled
        if (wakeLockEnabled) {
            requestWakeLock();
        }
        
        // Event listener sur le toggle
        wakeLockToggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            localStorage.setItem('wakeLockEnabled', enabled);
            
            if (enabled) {
                await requestWakeLock();
            } else {
                await releaseWakeLock();
            }
        });
    }
    
    console.log('✅ Menu mobile initialisé');
}

// === WAKE LOCK FUNCTIONS ===
let wakeLock = null;

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
        console.warn('⚠️ Wake Lock API non supportée');
        updateWakeLockStatus('❌ Non supporté par votre navigateur');
        return false;
    }
    
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('✅ Wake Lock activé');
        updateWakeLockStatus('✅ Actif - Écran restera allumé');
        showNotification('🔋 Écran maintenu allumé', 'success');
        
        // Réactiver automatiquement si la page devient visible
        wakeLock.addEventListener('release', () => {
            console.log('⚠️ Wake Lock relâché');
            updateWakeLockStatus('⏸️ Inactif (écran éteint puis rallumé)');
        });
        
        return true;
    } catch (err) {
        console.error('❌ Erreur Wake Lock:', err);
        updateWakeLockStatus(`❌ Erreur: ${err.message}`);
        showNotification('❌ Impossible de maintenir l\'écran allumé', 'error');
        return false;
    }
}

async function releaseWakeLock() {
    if (wakeLock !== null) {
        try {
            await wakeLock.release();
            wakeLock = null;
            console.log('🔓 Wake Lock désactivé');
            updateWakeLockStatus('⏸️ Désactivé');
            showNotification('🔋 Verrouillage automatique réactivé', 'info');
        } catch (err) {
            console.error('❌ Erreur release Wake Lock:', err);
        }
    }
}

function updateWakeLockStatus(message) {
    const statusEl = document.getElementById('wake-lock-status');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

// Réactiver le Wake Lock quand la page redevient visible (après verrouillage)
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLock !== null) {
        const wakeLockToggle = document.getElementById('wake-lock-toggle');
        if (wakeLockToggle && wakeLockToggle.checked) {
            console.log('🔄 Réactivation Wake Lock après visibilité');
            await requestWakeLock();
        }
    }
});

// Exposer les fonctions mobile
window.openMobileMenu = openMobileMenu;
window.closeMobileMenu = closeMobileMenu;
window.syncDesktopToMobile = syncDesktopToMobile;
window.requestWakeLock = requestWakeLock;
window.releaseWakeLock = releaseWakeLock;

console.log('✅ Script du jeu de piste chargé avec succès !');

