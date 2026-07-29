// Site theme Color mode
// The class is already painted by the inline snippet in <head>; this file owns
// the switcher, persistence, and keeping the mobile browser UI in sync.
var THEME_BG = { dark: '#18191a', light: '#F2F5F8' };

function paintTheme(theme) {
    var root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    // Drives native form controls / scrollbars, and the address bar colour on mobile.
    root.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_BG[theme]);
}

// An explicit choice from the switcher, or null if the visitor has never
// picked one. Distinguishing "no choice" from "light" is what lets the OS
// setting apply to first-time visitors.
function storedTheme() {
    try {
        return localStorage.theme === 'dark' || localStorage.theme === 'light'
            ? localStorage.theme
            : null;
    } catch (e) {
        return null; // storage blocked (private mode)
    }
}

function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
}

// Explicit choice wins; otherwise follow the device. Phones are usually a
// fresh browser with no stored choice, so without the fallback the site
// rendered light even with the phone in system dark mode.
function activeTheme() {
    return storedTheme() || systemTheme();
}

function storeTheme(theme) {
    try {
        localStorage.theme = theme;
    } catch (e) { /* non-fatal: theme still applies for this page view */ }
}

// Re-assert on load, so the script still works if a page is missing the
// <head> snippet.
paintTheme(activeTheme());

// Follow the OS if the visitor is riding the system default.
if (window.matchMedia) {
    var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    var onSystemChange = function () {
        if (!storedTheme()) paintTheme(systemTheme());
    };
    if (darkQuery.addEventListener) {
        darkQuery.addEventListener('change', onSystemChange);
    } else if (darkQuery.addListener) {
        darkQuery.addListener(onSystemChange); // Safari < 14
    }
}

var getUrlParameter = function getUrlParameter(sParam) {
    var sPageURL = window.location.search.substring(1),
        sURLVariables = sPageURL.split('&'),
        sParameterName,
        i;

    for (i = 0; i < sURLVariables.length; i++) {
        sParameterName = sURLVariables[i].split('=');

        if (sParameterName[0] === sParam) {
            return sParameterName[1] === undefined ? true : decodeURIComponent(sParameterName[1]);
        }
    }
    return false;
};
var version = getUrlParameter('version');

function setDarkTheme() {
    paintTheme('dark');
    storeTheme('dark');
    $('#light_theme').removeClass('active');
    $('#dark_theme').addClass('active');
};
function setLightTheme() {
    paintTheme('light');
    storeTheme('light');
    $('#dark_theme').removeClass('active');
    $('#light_theme').addClass('active');
};
function onThemeSwitcherItemClick(e) {
    var theme = this.dataset.theme;
    if (theme == "dark") {
        setDarkTheme();        
    } else {
        setLightTheme();
    }
};

const themeSwitcherItems = document.querySelectorAll(".switcher-input");
themeSwitcherItems.forEach((item) => {
    item.addEventListener("click", onThemeSwitcherItemClick);
});

if ( activeTheme() === 'dark' ) {
    $('#dark_theme').addClass('active');
} else  {
    $('#light_theme').addClass('active');
}
if(version) {
    if (version == 'dark') {
        setDarkTheme();
    } else if (version == 'light') {
        setLightTheme(); 
    }
}