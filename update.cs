using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;

internal static class CreativeAutomationUpdater
{
    private const string RepoZipUrl = "https://github.com/ptrgiang/creative-automation/archive/refs/heads/main.zip";
    private const string RootFolder = "creative-automation-main";
    private const string UpdaterExeName = "update.exe";

    private static readonly HashSet<string> PreservedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        ".git",
        UpdaterExeName
    };

    private static int Main()
    {
        string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string tempRoot = Path.Combine(Path.GetTempPath(), "creative-automation-update-" + Guid.NewGuid().ToString("N"));
        string zipPath = Path.Combine(tempRoot, "creative-automation-main.zip");
        string extractDir = Path.Combine(tempRoot, "extract");
        string backupDir = Path.Combine(tempRoot, "backup");

        try
        {
            Directory.CreateDirectory(tempRoot);
            Directory.CreateDirectory(extractDir);
            Directory.CreateDirectory(backupDir);

            Step("Backing up current extension folder");
            CopyDirectory(appDir, backupDir, true);

            Step("Downloading latest Creative Automation");
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            using (var client = new WebClient())
            {
                client.DownloadFile(RepoZipUrl, zipPath);
            }

            Step("Extracting update");
            ZipFile.ExtractToDirectory(zipPath, extractDir);
            string sourceDir = Path.Combine(extractDir, RootFolder);
            if (!Directory.Exists(sourceDir))
            {
                throw new InvalidOperationException("Update package did not contain the expected folder: " + sourceDir);
            }

            Step("Mirroring latest files");
            MirrorDirectory(sourceDir, appDir);

            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("Creative Automation is up to date.");
            Console.ResetColor();
            Console.WriteLine("Backup saved at: " + backupDir);
            Console.WriteLine("Open chrome://extensions and click reload for Creative Automation.");
            Pause();
            return 0;
        }
        catch (Exception ex)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("Update failed.");
            Console.ResetColor();
            Console.WriteLine("Backup is available at: " + backupDir);
            Console.WriteLine(ex.Message);
            Pause();
            return 1;
        }
    }

    private static void Step(string message)
    {
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("==> " + message);
        Console.ResetColor();
    }

    private static void Pause()
    {
        Console.WriteLine();
        Console.WriteLine("Press any key to close...");
        Console.ReadKey(true);
    }

    private static void MirrorDirectory(string sourceDir, string targetDir)
    {
        CopyDirectory(sourceDir, targetDir, true);

        foreach (string targetPath in Directory.GetFileSystemEntries(targetDir))
        {
            string name = Path.GetFileName(targetPath);
            if (PreservedNames.Contains(name)) continue;

            string sourcePath = Path.Combine(sourceDir, name);
            if (File.Exists(sourcePath) || Directory.Exists(sourcePath)) continue;

            if (Directory.Exists(targetPath)) Directory.Delete(targetPath, true);
            else File.Delete(targetPath);
        }
    }

    private static void CopyDirectory(string sourceDir, string targetDir, bool recursive)
    {
        Directory.CreateDirectory(targetDir);

        foreach (string sourceFile in Directory.GetFiles(sourceDir))
        {
            string name = Path.GetFileName(sourceFile);
            if (string.Equals(name, UpdaterExeName, StringComparison.OrdinalIgnoreCase)) continue;
            File.Copy(sourceFile, Path.Combine(targetDir, name), true);
        }

        if (!recursive) return;

        foreach (string sourceSubdir in Directory.GetDirectories(sourceDir))
        {
            string name = Path.GetFileName(sourceSubdir);
            if (string.Equals(name, ".git", StringComparison.OrdinalIgnoreCase)) continue;
            CopyDirectory(sourceSubdir, Path.Combine(targetDir, name), true);
        }
    }
}
