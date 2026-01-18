using AudioEditorWebApp.Models;
using Microsoft.AspNetCore.Mvc;
using System.Diagnostics;
using System.Globalization;

namespace AudioEditorWebApp.Controllers
{
    [ApiController]
    [Route("api/export")]
    public class ExportController : ControllerBase
    {
        // =====================================================
        // Экспорт аудио файла с применением настроек
        // =====================================================
        [HttpPost]
        public async Task<IActionResult> Export(
            IFormFile audioFile,
            [FromForm] ExportRequest settings)
        {
            // Валидация входных данных
            if (audioFile == null || audioFile.Length == 0)
                return BadRequest("Файл не передан");

            // Создаём временную директорию
            var tempDir = Path.Combine(Directory.GetCurrentDirectory(), "TempAudio");
            Directory.CreateDirectory(tempDir);

            var inputPath = Path.Combine(
                tempDir,
                Guid.NewGuid() + Path.GetExtension(audioFile.FileName)
            );

            // Определяем расширение выходного файла
            var outputExt = settings.Format?.ToLower() == "mp3" ? ".mp3" : ".wav";
            var outputPath = Path.Combine(
                tempDir,
                Guid.NewGuid() + "_export" + outputExt
            );

            try
            {
                // =====================================================
                // Сохраняем оригинальный файл
                // =====================================================
                await using (var fs = new FileStream(inputPath, FileMode.Create))
                {
                    await audioFile.CopyToAsync(fs);
                }

                // =====================================================
                // Парсим и нормализуем параметры
                // =====================================================
                // Скорость
                if (!double.TryParse(
                        settings.Speed,
                        NumberStyles.Float,
                        CultureInfo.InvariantCulture,
                        out var speed))
                {
                    return BadRequest($"Некорректное значение Speed: {settings.Speed}");
                }

                speed = Math.Clamp(speed, 0.25, 4.0);

                // Глобальная громкость
                var volume = Math.Clamp(settings.Volume, 0.0, 2.0);

                // =====================================================
                // Частота дискретизации (корректируем для MP3)
                // =====================================================
                var sampleRate = settings.SampleRate;

                // Для MP3 ограничиваем частоту дискретизации
                if (settings.Format == "mp3")
                {
                    sampleRate = sampleRate switch
                    {
                        96000 => 48000, // Понижаем 96к до 48к
                        44100 => 44100,
                        48000 => 48000,
                        _ => 44100 // Значение по умолчанию
                    };
                }

                // =====================================================
                // Формируем фильтры FFmpeg
                // =====================================================
                var filters = new List<string>();

                // Обрезка по региону
                if (settings.ExportScope == "region"
                    && settings.RegionStart.HasValue
                    && settings.RegionEnd.HasValue)
                {
                    filters.Add(
                        $"atrim=start={settings.RegionStart.Value.ToString(CultureInfo.InvariantCulture)}:" +
                        $"end={settings.RegionEnd.Value.ToString(CultureInfo.InvariantCulture)}"
                    );
                }

                // Громкость
                if (Math.Abs(volume - 1.0) > 0.001)
                {
                    // Ограничиваем громкость для предотвращения клиппинга
                    var safeVolume = Math.Min(volume, 5.0); // Максимум 5x
                    filters.Add($"volume={safeVolume.ToString(CultureInfo.InvariantCulture)}");

                    // Если громкость выше 1.0, добавляем ограничитель
                    if (volume > 1.0)
                    {
                        filters.Add("alimiter=level_in=1:level_out=1:limit=0.8");
                    }
                }

                // Fade In
                if (settings.FadeInStart.HasValue && settings.FadeInEnd.HasValue)
                {
                    var d = settings.FadeInEnd.Value - settings.FadeInStart.Value;
                    filters.Add(
                        $"afade=t=in:st={settings.FadeInStart.Value.ToString(CultureInfo.InvariantCulture)}:" +
                        $"d={d.ToString(CultureInfo.InvariantCulture)}"
                    );
                }

                // Fade Out
                if (settings.FadeOutStart.HasValue && settings.FadeOutEnd.HasValue)
                {
                    var d = settings.FadeOutEnd.Value - settings.FadeOutStart.Value;
                    filters.Add(
                        $"afade=t=out:st={settings.FadeOutStart.Value.ToString(CultureInfo.InvariantCulture)}:" +
                        $"d={d.ToString(CultureInfo.InvariantCulture)}"
                    );
                }


                // Скорость
                if (Math.Abs(speed - 1.0) > 0.001)
                {
                    filters.AddRange(BuildAtempoChain(speed));
                }

                var filterChain = filters.Any()
                    ? $"-af \"{string.Join(",", filters)}\""
                    : "";

                // =====================================================
                // Формируем команду FFmpeg
                // =====================================================
                string args;

                if (settings.Format == "mp3")
                {
                    // Настройки для MP3
                    var bitrate = settings.Mp3Bitrate ?? 192;
                    bitrate = Math.Clamp(bitrate, 32, 320); // Ограничиваем диапазон битрейта

                    args = $"-y -i \"{inputPath}\" " +
                           $"{filterChain} " +
                           $"-ar {sampleRate} " +
                           $"-acodec libmp3lame " +
                           $"-b:a {bitrate}k " +
                           $"-ac 2 " + // стерео
                           $"-write_xing 0 " +
                           $"\"{outputPath}\"";
                }
                else
                {
                    // Настройки для WAV
                    var codec = settings.BitDepth switch
                    {
                        16 => "pcm_s16le",
                        24 => "pcm_s24le",
                        32 => "pcm_f32le",
                        _ => "pcm_s16le"
                    };

                    args = $"-y -i \"{inputPath}\" " +
                           $"{filterChain} " +
                           $"-ar {sampleRate} " +
                           $"-acodec {codec} " +
                           $"\"{outputPath}\"";
                }

                // =====================================================
                // Запуск FFmpeg
                // =====================================================
                var process = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "ffmpeg",
                        Arguments = args,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true
                    }
                };

                process.Start();
                var ffmpegError = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (!System.IO.File.Exists(outputPath))
                {
                    return StatusCode(500, $"FFmpeg ошибка:\n{ffmpegError}"
                    );
                }

                // =====================================================
                // Подготавливаем имя выходного файла
                // ====================================================
                var safeFileName = Path.GetFileName(settings.FileName);

                // Если имя файла не указано, используем имя по умолчанию
                if (string.IsNullOrWhiteSpace(safeFileName))
                {
                    safeFileName = settings.Format == "mp3"
                        ? "mysoundlab_export.mp3"
                        : "mysoundlab_export.wav";
                }
                else
                {
                    // Корректируем расширение в соответствии с форматом
                    var ext = Path.GetExtension(safeFileName).ToLower();
                    var expectedExt = settings.Format == "mp3" ? ".mp3" : ".wav";

                    if (ext != expectedExt)
                    {
                        safeFileName = Path.ChangeExtension(safeFileName, expectedExt);
                    }
                }

                // =====================================================
                // Отдаём файл пользователю
                // =====================================================
                var bytes = await System.IO.File.ReadAllBytesAsync(outputPath);
                var mimeType = settings.Format == "mp3"
                    ? "audio/mpeg"
                    : "audio/wav";

                return File(bytes, mimeType, safeFileName);
            }
            finally
            {
                // Очищаем временные файлы
                SafeDelete(inputPath);
                SafeDelete(outputPath);
            }
        }

        // =====================================================
        // Вспомогательные методы
        // =====================================================

        // Строит цепочку фильтров atempo для заданной скорости
        private static List<string> BuildAtempoChain(double speed)
        {
            var filters = new List<string>();

            while (speed > 2.0)
            {
                filters.Add("atempo=2.0");
                speed /= 2.0;
            }

            while (speed < 0.5)
            {
                filters.Add("atempo=0.5");
                speed /= 0.5;
            }

            filters.Add(
                $"atempo={speed.ToString(CultureInfo.InvariantCulture)}"
            );

            return filters;
        }

        // Безопасное удаление временного файла
        private static void SafeDelete(string path)
        {
            try
            {
                if (System.IO.File.Exists(path))
                    System.IO.File.Delete(path);
            }
            catch
            {
                // ignore
            }
        }
    }
}