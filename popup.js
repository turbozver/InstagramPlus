const fields = [
    "instdecreasevolume",
    "instdecreasevolume_value",
    "instspacepause",
    "instmalwaysmute",
    "instaddcontrols",
    "instaddpostslidecontrols",
    "instaddseekbar",
    "instSeekSmallSeconds",
    "instSeekMediumSeconds",
    "instSeekLargeSeconds"
];
const toggleFields = [
    "instdecreasevolume",
    "instspacepause",
    "instmalwaysmute",
    "instaddcontrols",
    "instaddpostslidecontrols",
    "instaddseekbar"
];
const keyFields = [
    "instPauseKey",
    "instMuteKey",
    "instSeekSmallBackKey",
    "instSeekSmallForwardKey",
    "instSeekMediumBackKey",
    "instSeekMediumForwardKey",
    "instSeekLargeBackKey",
    "instSeekLargeForwardKey"
];
const storageFields = [...fields, ...keyFields, "instVolumeScale"];

const defaults = {
    instdecreasevolume: false,
    instdecreasevolume_value: 3.5,
    instspacepause: false,
    instmalwaysmute: false,
    instaddcontrols: false,
    instaddpostslidecontrols: false,
    instaddseekbar: false,
    instPauseKey: "Space",
    instMuteKey: "KeyM",
    instSeekSmallBackKey: "KeyQ",
    instSeekSmallForwardKey: "KeyE",
    instSeekMediumBackKey: "KeyA",
    instSeekMediumForwardKey: "KeyD",
    instSeekLargeBackKey: "KeyZ",
    instSeekLargeForwardKey: "KeyC",
    instSeekSmallSeconds: 0.1,
    instSeekMediumSeconds: 1,
    instSeekLargeSeconds: 3
};

const status = document.getElementById("status");
const volumeValue = document.getElementById("volumeValue");
let pendingKeyField = null;

chrome.storage.local.get(storageFields, (data) => {
    migrateVolumeValue(data);
    fields.forEach((name) => setField(name, data[name] ?? defaults[name]));
    keyFields.forEach((name) => setKeyButton(name, data[name] ?? defaults[name]));
    updateStatus(data);
    updateVolumeValue(data.instdecreasevolume_value ?? defaults.instdecreasevolume_value);
});

document.getElementById("settingsBtn").addEventListener("click", () => switchView("settings"));
document.getElementById("backBtn").addEventListener("click", () => switchView("main"));
document.addEventListener("input", handleFieldChange);
document.addEventListener("change", handleFieldChange);
document.getElementById("exportBtn").addEventListener("click", exportSettings);
document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", importSettings);
document.getElementById("resetBtn").addEventListener("click", resetSettings);
document.querySelectorAll(".keybind-button").forEach((button) => {
    button.addEventListener("click", () => startKeyCapture(button.dataset.bindSetting));
});
document.addEventListener("keydown", handleKeyCapture, true);

function handleFieldChange(event) {
    const field = event.target;
    if (!fields.includes(field.name)) return;

    const value = field.type === "checkbox"
        ? field.checked
        : field.type === "range"
            ? normalizeVolumePercent(field.value)
            : field.type === "number"
                ? normalizeSeconds(field.value, defaults[field.name])
                : field.value;

    chrome.storage.local.set({ [field.name]: value }, () => {
        broadcastSettingChanged(field.name, value);
        chrome.storage.local.get(fields, updateStatus);
    });

    if (field.name === "instdecreasevolume_value") {
        updateVolumeValue(value);
    }
}

function setField(name, value) {
    const field = document.querySelector(`[name="${name}"]`);
    if (!field) return;

    if (field.type === "checkbox") {
        field.checked = !!value;
    } else {
        field.value = value;
    }
}

function startKeyCapture(name) {
    if (!keyFields.includes(name)) return;

    stopKeyCapture();
    pendingKeyField = name;

    const button = getKeyButton(name);
    if (!button) return;

    button.classList.add("capturing");
    button.textContent = "Press key...";
}

function stopKeyCapture() {
    if (!pendingKeyField) return;

    const field = pendingKeyField;
    const button = getKeyButton(field);
    if (button) {
        button.classList.remove("capturing");
        chrome.storage.local.get([field], (data) => {
            setKeyButton(field, data[field] ?? defaults[field]);
        });
    }

    pendingKeyField = null;
}

function handleKeyCapture(event) {
    if (!pendingKeyField) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (event.code === "Escape") {
        stopKeyCapture();
        return;
    }

    const shortcut = eventToShortcut(event);
    if (!shortcut) return;

    const field = pendingKeyField;
    chrome.storage.local.set({ [field]: shortcut }, () => {
        setKeyButton(field, shortcut);
        broadcastSettingChanged(field, shortcut);
        stopKeyCapture();
    });
}

function setKeyButton(name, shortcut) {
    const button = getKeyButton(name);
    if (!button) return;
    button.textContent = formatShortcut(shortcut);
    button.title = "Click to change";
}

function getKeyButton(name) {
    return document.querySelector(`[data-bind-setting="${name}"]`);
}

function updateStatus(data) {
    const enabled = toggleFields.some((name) => !!data[name]);

    status.textContent = enabled ? "Enabled" : "Disabled";
    status.style.color = enabled ? "var(--accent)" : "var(--muted)";
}

function updateVolumeValue(value) {
    volumeValue.textContent = `${normalizeVolumePercent(value).toFixed(1)}%`;
}

function migrateVolumeValue(data) {
    if (data.instVolumeScale === "percent") return;

    const oldValue = data.instdecreasevolume_value;
    const nextValue = oldValue === undefined
        ? defaults.instdecreasevolume_value
        : normalizeVolumePercent(Number(oldValue) / 10);

    data.instdecreasevolume_value = nextValue;
    chrome.storage.local.set({
        instdecreasevolume_value: nextValue,
        instVolumeScale: "percent"
    });
}

function normalizeVolumePercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
}

function normalizeSeconds(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.round(Math.min(number, 600) * 100) / 100;
}

function eventToShortcut(event) {
    const modifierCodes = ["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"];
    if (modifierCodes.includes(event.code)) return "";

    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    parts.push(event.code);
    return parts.join("+");
}

function formatShortcut(shortcut) {
    if (!shortcut) return "None";

    return shortcut
        .split("+")
        .map((part) => {
            if (part.startsWith("Key")) return part.slice(3);
            if (part.startsWith("Digit")) return part.slice(5);
            if (part === "Space") return "Space";
            if (part.startsWith("Arrow")) return part.replace("Arrow", "");
            return part;
        })
        .join(" + ");
}

function switchView(view) {
    document.getElementById("mainView").classList.toggle("hidden", view !== "main");
    document.getElementById("settingsView").classList.toggle("hidden", view !== "settings");
}

function broadcastSettingChanged(name, value) {
    chrome.tabs.query({ url: ["https://instagram.com/*", "https://www.instagram.com/*"] }, (tabs) => {
        tabs.forEach((tab) => {
            chrome.tabs.sendMessage(tab.id, { type: "setting_changed", name, value }, () => {
                if (chrome.runtime.lastError) {}
            });
        });
    });
}

function exportSettings() {
    chrome.storage.local.get(storageFields, (data) => {
        const payload = {
            name: "Instagram Plus",
            exportedAt: new Date().toISOString(),
            settings: data
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `instagram-plus-settings-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}

function importSettings(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(reader.result);
            const settings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : parsed;
            const nextSettings = {};

            storageFields.forEach((field) => {
                if (field in settings) nextSettings[field] = settings[field];
            });

            chrome.storage.local.set(nextSettings, () => {
                Object.entries(nextSettings).forEach(([name, value]) => broadcastSettingChanged(name, value));
                location.reload();
            });
        } catch (error) {
            alert(`Import failed: ${error.message}`);
        } finally {
            event.target.value = "";
        }
    };
    reader.readAsText(file);
}

function resetSettings() {
    if (!confirm("Delete all Instagram Plus settings?")) return;

    chrome.storage.local.remove(storageFields, () => {
        Object.entries(defaults).forEach(([name, value]) => broadcastSettingChanged(name, value));
        location.reload();
    });
}
