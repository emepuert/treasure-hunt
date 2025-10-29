# 🏛️ Treasure Hunt - Interactive Web Application

An interactive web application for geolocated treasure hunts to discover places during team building events or tourist activities.

## 🎯 Features

- **Interactive map** with OpenStreetMap (free API)
- **Real-time GPS geolocation**
- **Complete admin interface** to manage teams and routes
- **Automatic proximity detection** (50m)
- **Mobile-first optimized interface**
- **Firebase backend** for real-time synchronization
- **Team system** with individual progression
- **Varied challenge types** (riddles, photos, information)

## 🚀 Installation

### 1. Firebase Configuration

1. Create a Firebase project on [https://console.firebase.google.com/](https://console.firebase.google.com/)
2. Enable Firestore Database and Authentication
3. Create a `firebase-config.js` file with your Firebase keys:

```javascript
export const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID",
    measurementId: "YOUR_MEASUREMENT_ID"
};
```

### 2. Deployment

- **GitHub Pages**: Enable GitHub Pages in repository settings
- **Netlify/Vercel**: Connect your repository for automatic deployment
- **Local server**: Use `python -m http.server` or `npx serve`

## 🎮 Usage

### Player Interface
1. Open `index.html` in your mobile browser
2. Log in with your credentials provided by the organizer
3. Allow geolocation
4. Follow the clues to discover points of interest

### Admin Interface
1. Access `admin.html`
2. Log in with your Firebase account
3. Create teams, users, checkpoints and routes
4. Track progress in real-time
5. Manage manual validations

## 📱 Compatibility

- ✅ iOS/Android smartphones
- ✅ Modern browsers (Chrome, Safari, Firefox)
- ✅ HTTPS required for geolocation

## 🛠️ Technologies

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Mapping**: Leaflet.js + OpenStreetMap
- **Backend**: Firebase (Firestore + Authentication)
- **GPS Navigation**: OpenRouteService API
- **Deployment**: GitHub Pages compatible

## 🧪 Local Testing

To test without being on the field, use the browser console:

```javascript
// Simulate a position
simulatePosition(49.0928, 6.1907);
```

## ⚠️ Security

- **Never commit** the `firebase-config.js` file with real keys
- Configure appropriate Firestore security rules
- HTTPS mandatory for geolocation

## 🎉 Advanced Features

- **Real-time synchronization** between players and admin
- **Multiple challenge types**: riddles, photos, information
- **Team management** with colors and custom routes
- **Mobile-friendly admin interface**
- **Real-time notifications**
- **Reset system and progression management**

## 📜 License

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

This project is licensed under **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** ([CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)).

### What this means:

✅ **You CAN**:
- Use this code for personal or educational projects
- Modify and adapt the code
- Share the code with others

❌ **You CANNOT**:
- Sell this code or use it commercially
- Remove credit to the original author

📋 **If you modify**:
- You must share your modifications under the same CC BY-NC-SA 4.0 license
- You must credit the original author

For more information, see the [full license text](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode).

---

🚀 **Ready for your next team building event!**