let wavesurfer;
let regionsPlugin;
let timelinePlugin;

let activeRegion = null;
let originalAudioFile = null;
let currentSpeed = 1.0;
let markers = []; // Массив маркеров (флажков)
let regionEffects = {
    fadeIn: null,
    fadeOut: null
};
let isUiBlocked = false; // Флаг блокировки UI

let currentZoom = 100; // Процентное значение для UI
let baseZoomValue = 1; // Базовое значение для WaveSurfer

// Константы для управления масштабированием
const MIN_ZOOM_UI = 100;  // Минимальный масштаб: 100%
const MAX_ZOOM_UI = 500;  // Максимальный масштаб: 500%
const ZOOM_STEP = 25;     // Шаг изменения масштаба в процентах

const uploadSection = document.getElementById("upload-section");
const editorSection = document.getElementById("editor-section");
const fileInput = document.getElementById("audioFile");
const loadBtn = document.getElementById("loadBtn");
const exportBtn = document.getElementById("exportBtn");

/* ===============================
   ЗАГРУЗКА ФАЙЛА И ИНИЦИАЛИЗАЦИЯ WAVESURFER
   =============================== */

loadBtn.addEventListener("click", () => {
    const file = fileInput.files[0];
    if (!file) {
        alert("Выберите аудиофайл!");
        return;
    }

    originalAudioFile = file;

    // Подставляем имя файла в поле экспорта
    const exportFileNameInput = document.getElementById("exportFileName");
    if (exportFileNameInput && file?.name) {
        exportFileNameInput.value = file.name;
    }

    const blobUrl = URL.createObjectURL(file);

    // Инициализация плагина регионов
    regionsPlugin = WaveSurfer.Regions.create({
        dragSelection: {
            slop: 2,
        },
        color: "rgba(168, 111, 216, 0.35)",
    });

    // Инициализация плагина таймлайна
    timelinePlugin = WaveSurfer.Timeline.create({
        container: "#wave-timeline"
    });

    // Создание основного экземпляра WaveSurfer
    wavesurfer = WaveSurfer.create({
        container: "#waveform",
        waveColor: "#a86fd8",
        progressColor: '#a86fd8',
        cursorColor: "#fff",
        height: 120,
        responsive: true,
        scrollParent: true,
        autoCenter: true,
        plugins: [
            regionsPlugin,
            timelinePlugin
        ]
    });

    wavesurfer.load(blobUrl);

    wavesurfer.on("ready", () => {
        setupWaveformDoubleClick(); // Настраиваем двойной клик для добавления маркеров

        // Инициализируем масштабирование после загрузки файла
        const duration = wavesurfer.getDuration();
        initializeZoom(duration);
    });

    // Обработчик создания нового региона
    regionsPlugin.on("region-created", (newRegion) => {
        const isMarker = newRegion.id && newRegion.id.startsWith('marker-'); // Проверяем, является ли новый регион маркером

        if (!isMarker) {
            // Если это обычный регион (не маркер) - удаляем другие обычные регионы
            regionsPlugin.getRegions().forEach(region => {
                const regionIsMarker = region.id && region.id.startsWith('marker-');
                if (region !== newRegion && !regionIsMarker) {
                    region.remove(); // Оставляем только один обычный регион
                }
            });
        }
    });

    // Обработчик клика по региону
    regionsPlugin.on("region-click", (region, e) => {
        const isMarker = region.id && region.id.startsWith('marker-');
        
        if (isMarker) {
            // Для маркеров - переходим к их позиции по клику
            e.stopPropagation();
            wavesurfer.setTime(region.start);
        } else {
            // Для обычных регионов - устанавливаем активный регион
            activeRegion = region;
        }
    });

    // Обработчик двойного клика по региону
    regionsPlugin.on("region-dblclick", (region, e) => {
        const isMarker = region.id && region.id.startsWith('marker-');
        
        if (isMarker) {
            e.stopPropagation();
            // Удаляем маркер по двойному клику
            if (confirm("Удалить этот флажок?")) {
                removeMarker(region);
            }
        }
    });

    // Переключаем видимость секций
    uploadSection.style.display = "none";
    editorSection.style.display = "block";
    exportBtn.style.display = "block";
});

/* ===============================
   ФУНКЦИИ ДЛЯ УПРАВЛЕНИЯ МАСШТАБОМ (ZOOM)
   =============================== */

const zoomSlider = document.getElementById("zoomSlider");
const zoomValue = document.getElementById("zoomValue");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");

// Обновление визуального отображения ползунка масштаба
function updateZoomSliderVisual(value) {
    const slider = document.getElementById("zoomSlider");
    const min = slider.min;
    const max = slider.max;

    const percent = ((value - min) / (max - min)) * 100;

    // Создаем градиентный фон для ползунка
    slider.style.background = `
        linear-gradient(
            to right,
            #a86fd8 0%,
            #a86fd8 ${percent}%,
            #4a2a5a ${percent}%,
            #4a2a5a 100%
        )
    `;

    // Обновляем подсветку активной кнопки быстрого доступа
    document.querySelectorAll(".quick-zoom-btn").forEach(btn => {
        btn.classList.toggle(
            "active",
            parseInt(btn.dataset.zoom) === parseInt(value)
        );
    });
}

// Преобразование UI процентов в значение для WaveSurfer
function uiPercentToWaveSurferZoom(uiPercent) {
    // Формула преобразования: 100% = базовое значение, 500% = 5x базового значения
    return (uiPercent / 100) * baseZoomValue;
}

// Инициализация базового значения zoom при загрузке файла
function initializeZoom(duration) {
    if (!wavesurfer || !duration) return;

    // Рассчитываем базовое значение так, чтобы весь трек помещался в видимую область
    const containerWidth = document.querySelector('#waveform').clientWidth;
    baseZoomValue = Math.max(1, containerWidth / duration);

    // Сбрасываем текущий zoom к 100%
    currentZoom = 100;
    applyZoom(currentZoom);
}

// Применение масштаба
function applyZoom(uiPercent) {
    if (!wavesurfer) return;

    // Ограничиваем значения масштаба
    currentZoom = Math.max(MIN_ZOOM_UI, Math.min(MAX_ZOOM_UI, uiPercent));

    // Преобразуем проценты в значение для WaveSurfer
    const waveSurferZoomValue = uiPercentToWaveSurferZoom(currentZoom);

    // Обновляем UI
    if (zoomSlider) {
        zoomSlider.value = currentZoom;
    }
    if (zoomValue) {
        zoomValue.textContent = `${currentZoom}%`;
    }

    updateZoomSliderVisual(currentZoom);

    // Применяем масштаб к WaveSurfer
    wavesurfer.zoom(waveSurferZoomValue);
}


// Настройка обработчиков для элементов управления масштабом
if (zoomSlider) {
    zoomSlider.min = MIN_ZOOM_UI;
    zoomSlider.max = MAX_ZOOM_UI;
    zoomSlider.step = ZOOM_STEP;
    zoomSlider.value = currentZoom;

    zoomSlider.addEventListener("input", (e) => {
        applyZoom(parseInt(e.target.value));
    });
}

// Кнопка увеличения масштаба
if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
        const newZoom = Math.min(MAX_ZOOM_UI, currentZoom + ZOOM_STEP);
        applyZoom(newZoom);
    });
}

// Кнопка уменьшения масштаба
if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
        const newZoom = Math.max(MIN_ZOOM_UI, currentZoom - ZOOM_STEP);
        applyZoom(newZoom);
    });
}

// Горячие клавиши для управления масштабом
document.addEventListener("keydown", (e) => {
    if (!wavesurfer) return;

    // Ctrl+= или Ctrl++ для увеличения масштаба
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const newZoom = Math.min(MAX_ZOOM_UI, currentZoom + ZOOM_STEP);
        applyZoom(newZoom);
    }

    // Ctrl+- для уменьшения масштаба
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        const newZoom = Math.max(MIN_ZOOM_UI, currentZoom - ZOOM_STEP);
        applyZoom(newZoom);
    }

    // Ctrl+0 для сброса масштаба к 100%
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        applyZoom(100);
    }
});

/* ===============================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ РАБОТЫ С WAVEFORM
   =============================== */

// Инициализация обработчиков для быстрых кнопок масштаба после загрузки DOM
document.addEventListener("DOMContentLoaded", () => {
    // Обработчики для быстрых кнопок масштаба
    document.querySelectorAll('.quick-zoom-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const zoomLevel = parseInt(btn.dataset.zoom);
            applyZoom(zoomLevel);
        });
    });
});

/* ===============================
   ФУНКЦИИ ДЛЯ РАБОТЫ С МАРКЕРАМИ (ФЛАЖКАМИ)
   =============================== */

// Добавление нового маркера
function addMarker(time, content = "🚩") {
    if (!wavesurfer || !regionsPlugin) return null;
    
    const markerId = `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const marker = regionsPlugin.addRegion({
        start: time,
        end: time,
        drag: true,
        resize: false,
        color: "rgba(255, 82, 82, 0.7)",
        content: content,
        id: markerId
    });
    
    // Сохраняем маркер в массиве
    markers.push({
        id: markerId,
        region: marker,
        time: time,
        content: content
    });
    
    return marker;
}

// Удаление маркера
function removeMarker(markerRegion) {
    if (!markerRegion) return;
    
    // Удаляем из массива маркеров
    const markerIndex = markers.findIndex(m => m.id === markerRegion.id);
    if (markerIndex !== -1) {
        markers.splice(markerIndex, 1);
    }
    
    // Удаляем регион
    markerRegion.remove();
}

// Удаление всех маркеров
function removeAllMarkers() {
    if (!regionsPlugin) return;
    
    // Получаем все маркеры (регионы с ID, начинающимся с 'marker-')
    const allRegions = regionsPlugin.getRegions();
    const markerRegions = allRegions.filter(region => 
        region.id && region.id.startsWith('marker-')
    );
    
    // Удаляем все маркеры
    markerRegions.forEach(marker => {
        marker.remove();
    });
    
    // Очищаем массив маркеров
    markers = [];
    
    showNotification("Все флажки удалены", "info");
}

/* ===============================
   ФУНКЦИИ ДЛЯ РАБОТЫ С ОБЫЧНЫМИ РЕГИОНАМИ (ВЫДЕЛЕННЫМИ ОБЛАСТЯМИ)
   =============================== */

// Получение активного (обычного) региона
function getActiveRegion() {
    if (!regionsPlugin) return null;
    const regions = regionsPlugin.getRegions();
    
    // Ищем регион, который не является маркером
    return regions.find(region => 
        !(region.id && region.id.startsWith('marker-'))
    ) || null;
}

// Получение всех маркеров
function getAllMarkers() {
    if (!regionsPlugin) return [];
    const regions = regionsPlugin.getRegions();
    
    // Возвращаем только маркеры
    return regions.filter(region => 
        region.id && region.id.startsWith('marker-')
    );
}

/* ===============================
   КНОПКА СОЗДАНИЯ РЕГИОНА
   =============================== */

document.getElementById("createRegionBtn").addEventListener("click", () => {
    if (!wavesurfer) return;

    const duration = wavesurfer.getDuration();
    const currentTime = wavesurfer.getCurrentTime();

    // Длина создаваемого региона по умолчанию (в секундах)
    const REGION_LENGTH = 5;

    // Определяем границы региона
    let start = currentTime;
    let end = currentTime + REGION_LENGTH;

    // Корректируем конец региона, если он выходит за пределы трека
    if (end > duration) {
        end = duration;
        start = Math.max(0, end - REGION_LENGTH);
    }

    // Удаляем старый обычный регион (если есть)
    const existingRegion = getActiveRegion();
    if (existingRegion) {
        existingRegion.remove();
    }

    // Создаём новый обычный регион (без специального ID, чтобы не считался маркером)
    activeRegion = regionsPlugin.addRegion({
        start,
        end,
        color: "rgba(168, 111, 216, 0.35)",
        drag: true,
        resize: true
    });
});

/* ===============================
   КНОПКА УДАЛЕНИЯ РЕГИОНА
   =============================== */

document.getElementById("removeRegionBtn").addEventListener("click", () => {
    const region = getActiveRegion();
    if (region) {
        region.remove();
        activeRegion = null;
    } else {
        alert("Нет выделенного региона для удаления");
    }
});

/* ===============================
   КНОПКА "ФЛАЖОК" (ДОБАВЛЕНИЕ МАРКЕРА)
   =============================== */

document.getElementById("markerBtn").addEventListener("click", () => {
    if (!wavesurfer || !regionsPlugin) return;

    const time = wavesurfer.getCurrentTime();
    
    // Добавляем маркер с текущим временем
    addMarker(time, "🚩");
});

/* ===============================
   ДВОЙНОЙ КЛИК ПО WAVEFORM ДЛЯ ДОБАВЛЕНИЯ МАРКЕРА
   =============================== */

function setupWaveformDoubleClick() {
    const waveformContainer = document.getElementById("waveform");
    
    if (!waveformContainer) return;
    
    let lastClickTime = 0;
    
    waveformContainer.addEventListener("click", (e) => {
        const currentTime = Date.now();
        
        // Проверяем двойной клик (интервал менее 300 мс)
        if (currentTime - lastClickTime < 300) {
            e.preventDefault();
            e.stopPropagation();
            
            // Добавляем маркер в позиции клика
            if (wavesurfer) {
                const rect = waveformContainer.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const relativePosition = x / rect.width;
                const time = relativePosition * wavesurfer.getDuration();
                
                addMarker(time, "🚩");
            }
        }
        
        lastClickTime = currentTime;
    });
}

/* ===============================
   ВОСПРОИЗВЕДЕНИЕ АУДИО
   =============================== */

document.getElementById("playPauseBtn").addEventListener("click", () => {
    if (wavesurfer) wavesurfer.playPause();
});

/* ===============================
   УПРАВЛЕНИЕ СКОРОСТЬЮ ВОСПРОИЗВЕДЕНИЯ
   =============================== */

const speedModal = document.getElementById("speedModal");
const speedBtn = document.getElementById("speedBtn");
const speedRange = document.getElementById("speedRange");
const speedValue = document.getElementById("speedValue");
const cancelSpeedBtn = document.getElementById("cancelSpeedBtn");
const applySpeedBtn = document.getElementById("applySpeedBtn");

// Открытие модального окна настройки скорости
speedBtn.addEventListener("click", () => {
    blockExportButton("Закройте окно изменения скорости");
    speedModal.style.display = "block";
    speedRange.value = wavesurfer ? wavesurfer.getPlaybackRate() : 1;
    speedValue.textContent = `${speedRange.value}x`;
});

// Обновление отображения значения скорости
speedRange.addEventListener("input", () => {
    speedValue.textContent = `${speedRange.value}x`;
});

// Отмена изменений скорости
cancelSpeedBtn.addEventListener("click", () => {
    closeModal(speedModal);
});

// Применение изменений скорости
applySpeedBtn.addEventListener("click", () => {
    currentSpeed = parseFloat(speedRange.value);
    wavesurfer.setPlaybackRate(currentSpeed);
    showNotification(`Скорость установлена на ${currentSpeed}x`, "success");
    closeModal(speedModal);
});

// Закрытие модальных окон при клике вне их области
window.addEventListener("click", (event) => {
    if (event.target === exportModal) {
        closeModal(exportModal);
    }

    if (event.target === speedModal) {
        closeModal(speedModal);
    }

    if (event.target === volumeModal) {
        closeModal(volumeModal);
    }
});


/* ===============================
   УПРАВЛЕНИЕ ЛОКАЛЬНОЙ ГРОМКОСТЬЮ (ПРЕДПРОСМОТР)
   =============================== */

const localVolume = document.getElementById("localVolume");
localVolume.addEventListener("input", () => {
    localVolumeValue = parseFloat(localVolume.value);
    updatePreviewVolume();
});

/* ===============================
   ПЕРЕМОТКА АУДИО
   =============================== */

const rewindValue = document.getElementById("rewindValue");
const rewindBackBtn = document.getElementById("rewindBackBtn");
const rewindForwardBtn = document.getElementById("rewindForwardBtn");

// Перемотка назад
rewindBackBtn.addEventListener("click", () => {
    if (!wavesurfer) return;

    const seconds = parseFloat(rewindValue.value);
    const newTime = Math.max(0, wavesurfer.getCurrentTime() - seconds);
    wavesurfer.seekTo(newTime / wavesurfer.getDuration());
});

// Перемотка вперед
rewindForwardBtn.addEventListener("click", () => {
    if (!wavesurfer) return;

    const seconds = parseFloat(rewindValue.value);
    const newTime = Math.min(
        wavesurfer.getDuration(),
        wavesurfer.getCurrentTime() + seconds
    );
    wavesurfer.seekTo(newTime / wavesurfer.getDuration());
});

/* ===============================
   ВЫПАДАЮЩИЙ СПИСОК ЭФФЕКТОВ
   =============================== */

const extraEffectsToggle = document.getElementById("extraEffectsToggle");
const extraEffectsList = document.getElementById("extraEffectsList");

// Переключение видимости списка эффектов
extraEffectsToggle.addEventListener("click", () => {
    const isVisible = extraEffectsList.style.display === "block";
    extraEffectsList.style.display = isVisible ? "none" : "block";

    extraEffectsToggle.textContent = isVisible
        ? "Другие эффекты ▼"
        : "Другие эффекты ▲";
});

// Обработчики кликов по элементам списка эффектов
extraEffectsList.querySelectorAll("li").forEach(effectItem => {
    effectItem.addEventListener("click", () => {
        const effectName = effectItem.dataset.effect;
        openEffectModal(effectName);
    });
});

/* ===============================
   ЗАГЛУШКА ПОД БУДУЩИЕ ЭФФЕКТЫ
   =============================== */

function openEffectModal(effect) {
    const region = getActiveRegion();

    if (!region) {
        alert("Сначала выделите участок аудио");
        return;
    }

    alert(
        `Эффект: ${effect}\n` +
        `От ${region.start.toFixed(2)} до ${region.end.toFixed(2)} сек`
    );
}

/* ===============================
   МОДАЛЬНОЕ ОКНО ЭКСПОРТА
   =============================== */

const exportModal = document.getElementById("exportModal");
const exportBtnOpen = document.getElementById("exportBtn");
const cancelExportBtn = document.getElementById("cancelExportBtn");
const confirmExportBtn = document.getElementById("confirmExportBtn");
const exportFormatSelect = document.getElementById("exportFormat");
const bitDepthSelect = document.getElementById("bitDepth");
const sampleRateSelect = document.getElementById("sampleRate");
const exportFileNameInput = document.getElementById("exportFileName");

// Обновление UI при изменении формата экспорта
exportFormatSelect.addEventListener("change", updateExportUI);

function updateExportUI() {
    const format = exportFormatSelect.value;
    const isMp3 = format === "mp3";
    const isWav = format === "wav";

    const wavSettings = document.getElementById("wavSettings");
    const mp3Settings = document.getElementById("mp3Settings");

    // Показываем/скрываем соответствующие настройки в зависимости от формата
    if (wavSettings) wavSettings.style.display = isWav ? "block" : "none";
    if (mp3Settings) mp3Settings.style.display = isMp3 ? "block" : "none";

    // Для MP3 отключаем Bit Depth (не поддерживается)
    bitDepthSelect.disabled = isMp3;
    if (isMp3) {
        bitDepthSelect.title = "Bit depth не поддерживается в MP3 формате";
    } else {
        bitDepthSelect.title = "";
    }

    // Для MP3 ограничиваем частоту дискретизации (96 kHz не поддерживается)
    Array.from(sampleRateSelect.options).forEach(option => {
        if (option.value === "96000") {
            option.disabled = isMp3;
            if (isMp3) {
                option.title = "96 kHz не поддерживается в MP3";
                // Если выбран MP3 и стоит 96000, меняем на 48000
                if (sampleRateSelect.value === "96000") {
                    sampleRateSelect.value = "48000";
                }
            } else {
                option.title = "";
            }
        }
    });

    // Обновляем имя файла с правильным расширением
    updateFileName();
}

// Обновление имени файла с правильным расширением
function updateFileName() {
    const format = exportFormatSelect.value;
    const currentName = exportFileNameInput.value;
    const nameWithoutExt = currentName.replace(/\.[^/.]+$/, "");
    const expectedExt = format === "mp3" ? 'mp3' : 'wav';

    // Проверяем, нужно ли менять расширение
    const currentExt = currentName.split('.').pop().toLowerCase();
    if (currentExt !== expectedExt) {
        exportFileNameInput.value = nameWithoutExt + "." + expectedExt;
    }
}

// Обновляем имя файла при изменении формата
exportFormatSelect.addEventListener("change", () => {
    updateExportUI();
});

// Открытие модального окна экспорта
exportBtnOpen.addEventListener("click", () => {
    updateExportUI();
    exportModal.style.display = "block";
});

// Закрытие окна экспорта по кнопке "Отмена"
cancelExportBtn.addEventListener("click", () => {
    closeModal(exportModal);
});

// Закрытие по клику вне окна экспорта
window.addEventListener("click", (event) => {
    if (event.target === exportModal) {
        exportModal.style.display = "none";
    }
});

/* ===============================
   КНОПКИ FADE IN / FADE OUT
   =============================== */

document.getElementById("fadeInBtn").addEventListener("click", () => {
    const region = getActiveRegion();
    if (!region) {
        alert("Сначала выделите регион");
        return;
    }

    // Сохраняем настройки Fade In для последующего экспорта
    regionEffects.fadeIn = {
        start: region.start,
        end: region.end
    };

    showNotification("Fade In применён к региону", "success");
});


document.getElementById("fadeOutBtn").addEventListener("click", () => {
    const region = getActiveRegion();
    if (!region) {
        alert("Сначала выделите регион");
        return;
    }

    // Сохраняем настройки Fade Out для последующего экспорта
    regionEffects.fadeOut = {
        start: region.start,
        end: region.end
    };

    showNotification("Fade Out применён к региону", "success");
});

/* ===============================
   ЭКСПОРТ ФАЙЛА (ОСНОВНАЯ ФУНКЦИЯ)
   =============================== */

confirmExportBtn.addEventListener("click", async () => {
    try {
        if (isUiBlocked) {
            alert("Сначала закройте все модальные окна");
            return;
        }

        const formData = new FormData();
        formData.append("audioFile", originalAudioFile);

        // Получаем настройки экспорта из UI
        const sampleRate = parseInt(sampleRateSelect.value);
        const bitDepth = parseInt(bitDepthSelect.value);
        const format = exportFormatSelect.value;

        // Для MP3 получаем битрейт из UI
        let mp3Bitrate = 192;
        const mp3BitrateSelect = document.getElementById("mp3Bitrate");
        if (mp3BitrateSelect && format === "mp3") {
            mp3Bitrate = parseInt(mp3BitrateSelect.value);
        }

        formData.append("SampleRate", sampleRate);
        formData.append("BitDepth", bitDepth);
        formData.append("Format", format);
        formData.append("Mp3Bitrate", mp3Bitrate);

        // Глобальная громкость (для экспорта)
        formData.append("Volume", globalVolume.toString().replace(",", "."));

        // Имя файла
        let exportFileName = exportFileNameInput.value.trim();
        if (!exportFileName) {
            exportFileName = format === "mp3"
                ? "mysoundlab_export.mp3"
                : "mysoundlab_export.wav";
        }

        // Убираем запрещённые символы из имени файла
        exportFileName = exportFileName.replace(/[<>:"/\\|?*]+/g, "");

        // Проверяем и корректируем расширение файла
        const ext = exportFileName.split('.').pop().toLowerCase();
        const expectedExt = format === "mp3" ? "mp3" : "wav";
        if (ext !== expectedExt) {
            exportFileName = exportFileName.replace(/\.[^/.]+$/, "") + "." + expectedExt;
        }

        formData.append("FileName", exportFileName);

        // Область экспорта (весь трек или выделенный фрагмент)
        const exportScope = document.querySelector(
            'input[name="exportScope"]:checked'
        )?.value ?? "all";

        formData.append("ExportScope", exportScope);

        if (exportScope === "region") {
            const region = getActiveRegion();

            if (!region) {
                alert("Вы выбрали экспорт фрагмента, но регион не выделен");
                return;
            }

            formData.append("RegionStart", region.start.toString().replace(",", "."));
            formData.append("RegionEnd", region.end.toString().replace(",", "."));
        }

        /// Скорость воспроизведения
        formData.append("Speed", currentSpeed.toString().replace(",", "."));

        // Настройки фейдинга
        if (regionEffects.fadeIn) {
            formData.append("FadeInStart", regionEffects.fadeIn.start);
            formData.append("FadeInEnd", regionEffects.fadeIn.end);
        }

        if (regionEffects.fadeOut) {
            formData.append("FadeOutStart", regionEffects.fadeOut.start);
            formData.append("FadeOutEnd", regionEffects.fadeOut.end);
        }

        // Отправка запроса на сервер для обработки и экспорта
        const response = await fetch("/api/export", {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ошибка экспорта: ${errorText}`);
        }

        const blob = await response.blob();

        // Проверяем, что полученный файл не пустой
        if (blob.size < 44) {
            throw new Error("Получен пустой или битый файл");
        }

        // Скачивание файла пользователем
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = exportFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification(`Экспорт успешно завершён: ${exportFileName}`, "success");
        exportModal.style.display = "none";
    } catch (error) {
        alert(`Ошибка при экспорте: ${error.message}`);
    }
});

/* ===============================
   ОБРЕЗКА ФАЙЛА
   =============================== */

document.getElementById("cutBtn").addEventListener("click", async () => {
    const region = getActiveRegion();
    
    if (!region) {
        alert("Сначала выделите регион");
        return;
    }

    if (!confirm("Обрезать выделенный фрагмент? Это действие нельзя отменить.")) {
        return;
    }

    const duration = wavesurfer.getDuration();

    // Защита от обрезки всего трека целиком
    if (region.start <= 0.01 && region.end >= duration - 0.01) {
        alert("Нельзя обрезать весь трек целиком — файл станет пустым.");
        return;
    }

    const formData = new FormData();
    formData.append("audioFile", originalAudioFile);
    formData.append("RegionStart", region.start.toString().replace(",", "."));
    formData.append("RegionEnd", region.end.toString().replace(",", "."));

    try {
        const response = await fetch("/api/edit/cut", {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(text);
        }

        const blob = await response.blob();

        // Заменяем текущий файл обрезанной версией
        originalAudioFile = new File([blob], originalAudioFile.name, {
            type: "audio/wav"
        });

        // Перезагружаем WaveSurfer с новым файлом
        wavesurfer.destroy();

        const url = URL.createObjectURL(blob);
        regionsPlugin = WaveSurfer.Regions.create({ dragSelection: true });

        wavesurfer = WaveSurfer.create({
            container: "#waveform",
            waveColor: "#a86fd8",
            progressColor: "#a86fd8",
            cursorColor: "#fff",
            height: 120,
            plugins: [regionsPlugin]
        });

        wavesurfer.load(url);
        activeRegion = null;
        markers = []; // Сбрасываем маркеры

        showNotification("Файл успешно обрезан", "success");
    } catch (err) {
        alert("Ошибка обрезки: " + err.message);
    }
});

/* ===============================
   ГОРЯЧИЕ КЛАВИШИ
   =============================== */

document.addEventListener("keydown", (e) => {
    if (!wavesurfer) return;
    if (e.target.matches("input, textarea")) return;

    const ctrl = e.ctrlKey || e.metaKey;
    
    // Добавить маркер
    if (ctrl && e.key === 'm') {
        e.preventDefault();
        document.getElementById("markerBtn").click();
    }
    
    // Удалить все маркеры
    if (ctrl && e.shiftKey && e.key === 'M') {
        e.preventDefault();

        const allMarkers = getAllMarkers();

        if (!allMarkers.length) {
            alert("Флажков нет");
            return;
        }

        if (confirm("Удалить все флажки?")) {
            removeAllMarkers();
        }
    }
    
    // Удалить ближайший маркер
    if (ctrl && e.key === 'd') {
        e.preventDefault();

        const currentTime = wavesurfer.getCurrentTime();
        const markers = getAllMarkers();

        if (!markers.length) return;

        // Поиск ближайшего маркера к текущей позиции
        const nearestMarker = markers.reduce((nearest, marker) => {
            const distance = Math.abs(marker.start - currentTime);

            // Игнорируем слишком далекие маркеры (> 0.1 сек)
            if (distance > 0.1) return nearest;

            // Если ближайшего ещё нет — берём этот
            if (!nearest) return marker;

            // Иначе сравниваем расстояния
            return distance < Math.abs(nearest.start - currentTime)
                ? marker
                : nearest;
        }, null);

        if (nearestMarker) {
            removeMarker(nearestMarker);
        }
    }

    // Воспроизведение / пауза
    if (e.code === 'Space' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        wavesurfer.playPause();
    }

    // Перемотка стрелками
    if (e.key === "ArrowLeft") {
        e.preventDefault();
        rewindBackBtn.click();
    }

    if (e.key === "ArrowRight") {
        e.preventDefault();
        rewindForwardBtn.click();
    }

    // Регионы
    if (ctrl && e.key.toLowerCase() === "r") {
        e.preventDefault();
        document.getElementById("createRegionBtn").click();
    }

    if (e.key === "Delete" || e.key === "Backspace") {
        const region = getActiveRegion();
        if (region) {
            e.preventDefault();
            region.remove();
            activeRegion = null;
        }
    }

    // Скорость
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        speedBtn.click();
    }

    if (ctrl && e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        currentSpeed = 1.0;
        wavesurfer.setPlaybackRate(1);
        showNotification("Скорость сброшена до 1x", "info");
    }

    // Громкость
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        volumeBtn.click();
    }

    if (ctrl && e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        globalVolume = 1.0;
        updatePreviewVolume();
        showNotification("Громкость сброшена до 100%", "info");
    }

    // Фейдинг
    if (ctrl && e.key.toLowerCase() === "i") {
        e.preventDefault();
        document.getElementById("fadeInBtn").click();
    }

    if (ctrl && e.key.toLowerCase() === "o") {
        e.preventDefault();
        document.getElementById("fadeOutBtn").click();
    }

    // Обрезка
    if (ctrl && e.key.toLowerCase() === "x") {
        e.preventDefault();
        document.getElementById("cutBtn").click();
    }

    // Экспорт
    if (ctrl && e.key.toLowerCase() === "e") {
        e.preventDefault();
        exportBtnOpen.click();
    }
});


/* ===============================
   КНОПКА УДАЛЕНИЯ ВСЕХ МАРКЕРОВ
   =============================== */

const removeAllMarkersBtn = document.getElementById("removeAllMarkersBtn");

if (removeAllMarkersBtn) {
    removeAllMarkersBtn.addEventListener("click", () => {
        const allMarkers = getAllMarkers();

        if (!allMarkers.length) {
            alert("Флажков нет");
            return;
        }

        if (confirm("Удалить все флажки?")) {
            removeAllMarkers();
        }
    });
}


/* ===============================
   ГЛОБАЛЬНАЯ ГРОМКОСТЬ (ДЛЯ ЭКСПОРТА)
   =============================== */

let globalVolume = 1.0;       // 0.0 – 2.0 (экспорт)
let localVolumeValue = 1.0;  // 0.0 – 1.0 (ползунок предпросмотра)

const volumeBtn = document.getElementById("volumeBtn");
const volumeModal = document.getElementById("volumeModal");
const globalVolumeRange = document.getElementById("globalVolumeRange");
const globalVolumeValue = document.getElementById("globalVolumeValue");
const globalVolumeDB = document.getElementById("globalVolumeDB");
const volumeWarning = document.getElementById("volumeWarning");
const previewVolumeBtn = document.getElementById("previewVolumeBtn");
const cancelVolumeBtn = document.getElementById("cancelVolumeBtn");
const applyVolumeBtn = document.getElementById("applyVolumeBtn");

// Открытие модального окна громкости
volumeBtn.addEventListener("click", () => {
    if (!wavesurfer) {
        alert("Сначала загрузите аудиофайл!");
        return;
    }

    blockExportButton("Закройте окно громкости");
    volumeModal.style.display = "block";

    // Устанавливаем текущее значение громкости в ползунок
    const sliderValue = Math.round(globalVolume * 100);
    globalVolumeRange.value = sliderValue;
    updateVolumeDisplay(sliderValue);

    // Подсвечиваем активную предустановку
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.remove('active');
        if (parseInt(btn.dataset.volume) === sliderValue) {
            btn.classList.add('active');
        }
    });

    // Показываем модальное окно
    volumeModal.style.display = "block";
});

/* ===============================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ УПРАВЛЕНИЯ ГРОМКОСТЬЮ
   =============================== */

// Обновление громкости предпросмотра
function updatePreviewVolume() {
    if (!wavesurfer) return;

    // Эффективная громкость = глобальная * локальная (ограничена 1.0)
    const effectiveVolume = Math.min(globalVolume * localVolumeValue, 1.0);
    wavesurfer.setVolume(effectiveVolume);
}

// Преобразование процентов в значение для WaveSurfer (0-1)
function percentToWaveSurferVolume(percent) {
    return Math.min(percent / 100, 1.0);
}

// Преобразование процентов в значение для экспорта (0-2)
function percentToExportVolume(percent) {
    return percent / 100; // 0-2.0
}

// Преобразование значения громкости в децибелы
function volumeToDB(volume) {
    if (volume <= 0) return "-∞";
    const db = 20 * Math.log10(volume);
    return Math.round(db * 10) / 10; // Округление до 0.1 dB
}

// Проверка, может ли значение громкости вызвать клиппинг
function willCauseClipping(volume) {
    return volume > 1.0;
}

// Обновление отображения значений громкости в UI
function updateVolumeDisplay(sliderValue) {
    // Процентное значение
    globalVolumeValue.textContent = `${sliderValue}%`;

    // Значение для экспорта (0.0 - 2.0)
    const exportVolume = sliderValue / 100;
    const exportVolumePercent = sliderValue;

    // Значение для WaveSurfer (0.0 - 1.0)
    const wavesurferVolume = percentToWaveSurferVolume(sliderValue);
    const wavesurferVolumePercent = Math.min(sliderValue, 100);

    // Преобразование в децибелы
    const dbValue = volumeToDB(exportVolume);
    globalVolumeDB.textContent = dbValue === "-∞" ? dbValue : `${dbValue} dB`;

    // Предупреждение о возможном клиппинге
    if (willCauseClipping(exportVolume)) {
        volumeWarning.style.display = "block";
        volumeWarning.innerHTML = `
            <div class="warning-content">
                <div class="warning-icon">⚠️</div>
                <div class="warning-text">
                    <strong>Внимание:</strong> Громкость ${exportVolumePercent}% может вызвать клиппинг (искажения).
                </div>
            </div>
        `;
    } else {
        volumeWarning.style.display = "none";
    }
}

// Обработчик изменения ползунка глобальной громкости
globalVolumeRange.addEventListener("input", () => {
    updateVolumeDisplay(globalVolumeRange.value);
});

// Обработчики предустановок громкости
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const volumePercent = parseInt(btn.dataset.volume);
        globalVolumeRange.value = volumePercent;
        updateVolumeDisplay(volumePercent);

        // Подсветка активной предустановки
        document.querySelectorAll('.preset-btn').forEach(b => {
            b.classList.remove('active');
        });
        btn.classList.add('active');
    });
});


// Отмена изменений громкости
cancelVolumeBtn.addEventListener("click", () => {
    closeModal(volumeModal);
});

// Применение изменений громкости
applyVolumeBtn.addEventListener("click", () => {
    const volumePercent = parseInt(globalVolumeRange.value);
    globalVolume = percentToExportVolume(volumePercent);

    updatePreviewVolume(); // Обновляем предпросмотр

    showNotification(
        `Громкость установлена на ${volumePercent}%`,
        'success'
    );

    closeModal(volumeModal);
});

// Закрытие модального окна громкости по клику вне его
window.addEventListener("click", (event) => {
    if (event.target === volumeModal) {
        volumeModal.style.display = "none";
    }
});

/* ===============================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ UI
   =============================== */

// Функция для показа уведомлений
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span class="notification-icon">${type === 'success' ? '✅' : 'ℹ️'}</span>
        <span class="notification-text">${message}</span>
    `;

    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#d4edda' : '#d1ecf1'};
        color: ${type === 'success' ? '#155724' : '#0c5460'};
        border: 1px solid ${type === 'success' ? '#c3e6cb' : '#bee5eb'};
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideIn 0.3s ease-out;
    `;

    document.body.appendChild(notification);

    // Автоматическое удаление уведомления через 3 секунды
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out forwards';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Блокировка кнопки экспорта (при открытых модальных окнах)
function blockExportButton(reason = "") {
    isUiBlocked = true;

    if (exportBtn) {
        exportBtn.disabled = true;
        exportBtn.classList.add("disabled");
        exportBtn.title = reason || "Экспорт временно недоступен";
    }
}

// Разблокировка кнопки экспорта
function unblockExportButton() {
    isUiBlocked = false;

    if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.classList.remove("disabled");
        exportBtn.title = "";
    }
}

// Закрытие модального окна с разблокировкой UI
function closeModal(modalElement) {
    if (!modalElement) return;

    modalElement.style.display = "none";
    unblockExportButton();
}

/* ===============================
    ПОДСКАЗКИ ПО ГОРЯЧИМ КЛАВИШАМ
   =============================== */
const HOTKEY_HINTS = {
    markerBtn: "Ctrl + M",
    removeAllMarkersBtn: "Ctrl + Shift + M",
    playPauseBtn: "Space",
    rewindBackBtn: "←",
    rewindForwardBtn: "→",
    cutBtn: "Ctrl + X",
    exportBtn: "Ctrl + E",
    createRegionBtn: "Ctrl + R",
    removeRegionBtn: "Delete",
    fadeInBtn: "Ctrl + I",
    fadeOutBtn: "Ctrl + O",
    speedBtn: "Ctrl + Shift + S",
    volumeBtn: "Ctrl + Shift + V",
    zoomInBtn: "Ctrl + +",
    zoomOutBtn: "Ctrl + -"
};

function applyHotkeyTooltips() {
    Object.entries(HOTKEY_HINTS).forEach(([id, hotkey]) => {
        const el = document.getElementById(id);
        if (!el) return;

        const baseTitle = el.getAttribute("title") || el.textContent || "";
        el.title = `${baseTitle} (${hotkey})`.trim();
    });
}

document.addEventListener("DOMContentLoaded", applyHotkeyTooltips);