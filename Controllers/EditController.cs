using Microsoft.AspNetCore.Mvc;
using System.Diagnostics;
using System.Globalization;

namespace AudioEditorWebApp.Controllers
{
    [ApiController]
    [Route("api/edit")]
    public class EditController : ControllerBase
    {
        // =====================================================
        // Вырезание региона из аудиофайла
        // =====================================================
        [HttpPost("cut")]
        public async Task<IActionResult> Cut(
            IFormFile audioFile,
            [FromForm] double RegionStart,
            [FromForm] double RegionEnd)
        {
            // Валидация входных данных
            if (audioFile == null || audioFile.Length == 0)
                return BadRequest("Файл не передан");

            if (RegionEnd <= RegionStart)
                return BadRequest("Некорректный регион");

            // Создаём временную директорию
            var tempDir = Path.Combine(Directory.GetCurrentDirectory(), "TempAudio");
            Directory.CreateDirectory(tempDir);

            var inputPath = Path.Combine(tempDir, Guid.NewGuid() + Path.GetExtension(audioFile.FileName));
            var part1 = Path.Combine(tempDir, Guid.NewGuid() + "_a.wav");
            var part2 = Path.Combine(tempDir, Guid.NewGuid() + "_b.wav");
            var output = Path.Combine(tempDir, Guid.NewGuid() + "_cut.wav");
            var concatFile = Path.Combine(tempDir, Guid.NewGuid() + ".txt");

            // Защита от обрезки всего трека целиком
            var durationCheckArgs = $"-i \"{inputPath}\" -hide_banner";
            var probe = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "ffprobe",
                    Arguments = "-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 \"" + inputPath + "\"",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            probe.Start();
            var durationStr = await probe.StandardOutput.ReadToEndAsync();
            await probe.WaitForExitAsync();

            if (double.TryParse(durationStr, NumberStyles.Float, CultureInfo.InvariantCulture, out var duration))
            {
                if (RegionStart <= 0.01 && RegionEnd >= duration - 0.01)
                {
                    return BadRequest("Нельзя обрезать весь трек целиком!");
                }
            }

            try
            {
                // Сохраняем исходный файл
                await using (var fs = new FileStream(inputPath, FileMode.Create))
                    await audioFile.CopyToAsync(fs);

                // Часть ДО региона
                await RunFFmpeg(
                    $"-y -i \"{inputPath}\" -t {RegionStart.ToString(CultureInfo.InvariantCulture)} \"{part1}\""
                );

                // Часть ПОСЛЕ региона
                await RunFFmpeg(
                    $"-y -i \"{inputPath}\" -ss {RegionEnd.ToString(CultureInfo.InvariantCulture)} \"{part2}\""
                );

                // Склейка частей
                await System.IO.File.WriteAllTextAsync(
                    concatFile,
                    $"file '{part1.Replace("\\", "/")}'\nfile '{part2.Replace("\\", "/")}'"
                );

                await RunFFmpeg(
                    $"-y -f concat -safe 0 -i \"{concatFile}\" -c copy \"{output}\""
                );

                // Отдаём результат пользователю
                var bytes = await System.IO.File.ReadAllBytesAsync(output);
                return File(bytes, "audio/wav", "cut.wav");
            }
            finally
            {
                // Очистка временных файлов
                SafeDelete(inputPath);
                SafeDelete(part1);
                SafeDelete(part2);
                SafeDelete(output);
                SafeDelete(concatFile);
            }
        }

        // =====================================================
        // Вспомогательные методы
        // =====================================================

        // Запуск FFmpeg с заданными аргументами
        private static async Task RunFFmpeg(string args)
        {
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "ffmpeg",
                    Arguments = args,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            process.Start();
            await process.WaitForExitAsync();
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
