namespace AudioEditorWebApp.Models
{
    public class ExportRequest
    {
        // =====================================================
        // 💾 Область экспорта
        // =====================================================
        public string ExportScope { get; set; }   // Весь файл | выделенный регион
        public double? RegionStart { get; set; } // Начало региона (в секундах)
        public double? RegionEnd { get; set; }   // Конец региона (в секундах)

        // =====================================================
        // ⏩ Скорость воспроизведения
        // =====================================================
        public string Speed { get; set; } = "1.0"; // 0.5 - 2.0

        // =====================================================
        // 🎚 Фейдинг
        // =====================================================
        public bool FadeIn { get; set; }
        public bool FadeOut { get; set; }

        public double? FadeInStart { get; set; } // Начало Fade In (в секундах)
        public double? FadeInEnd { get; set; } // Конец Fade In (в секундах)

        public double? FadeOutStart { get; set; } // Начало Fade Out (в секундах)
        public double? FadeOutEnd { get; set; } // Конец Fade Out (в секундах)

        // =====================================================
        // 🔊 Глобальная громкость
        // =====================================================
        public double Volume { get; set; } = 1.0; // 0.0 – 2.0

        // =====================================================
        // 🎵 Качество
        // =====================================================
        public int SampleRate { get; set; } = 44100; // Частота дискретизации (Hz)
        public int BitDepth { get; set; } = 16; // Битовая глубина (бит)
        public int? Mp3Bitrate { get; set; } = 192; // Битрейт для MP3 (kbps)

        // =====================================================
        // 📦 Формат и имя файла
        // =====================================================
        public string Format { get; set; } = "wav"; // Формат (wav | mp3)
        public string FileName { get; set; } = "export.wav"; // Имя экспортируемого файла
    }
}
