"""Stage the local web app, Node and a self-contained Kernel worker for a native installer."""

import argparse
from importlib.metadata import distribution
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import sysconfig
import tempfile

ROOT = Path(__file__).resolve().parents[2]
KERNEL = ROOT / "kernel"


def windows_library(work):
    shutil.copyfile(KERNEL / "cards_native.c", work / "cards_native.c")
    command = ["cl", "/nologo", "/O2", "/MT", "/LD", "/std:c11", "cards_native.c",
               "/link", "/OUT:cards_native.dll", "/EXPORT:score7", "/EXPORT:equity_mc", "/EXPORT:equity_v2"]
    if shutil.which("cl"):
        subprocess.run(command, cwd=work, check=True)
    else:
        vswhere = Path(os.environ["ProgramFiles(x86)"]) / "Microsoft Visual Studio/Installer/vswhere.exe"
        install = subprocess.check_output(
            [vswhere, "-latest", "-products", "*", "-requires",
             "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"],
            text=True, encoding="utf-8").strip()
        vcvars = Path(install) / "VC/Auxiliary/Build/vcvars64.bat"
        if not vcvars.is_file():
            raise RuntimeError("Install the Visual Studio C++ x64 build tools.")
        (work / "compile.cmd").write_text(
            '@echo off\ncall "%KERNEL_VCVARS%" >nul\nif errorlevel 1 exit /b 1\n' + " ".join(command) + "\n",
            encoding="ascii")
        subprocess.run([os.environ["COMSPEC"], "/d", "/c", "compile.cmd"], cwd=work, check=True,
                       env={**os.environ, "KERNEL_VCVARS": str(vcvars)})
    return work / "cards_native.dll"


def freeze_worker(destination, work):
    if os.name == "nt":
        library = windows_library(work)
    else:
        library = work / "cards_native.so"
        flags = ["-shared"]
        if sys.platform == "darwin":
            deployment = os.environ.get("MACOSX_DEPLOYMENT_TARGET", "13.5")
            flags = ["-dynamiclib", "-arch", platform.machine(), "-mmacosx-version-min=" + deployment]
        subprocess.run([os.environ.get("CC", "cc"), *flags, "-O3", "-std=c99", "-fPIC",
                        str(KERNEL / "cards_native.c"), "-o", str(library)], check=True)

    # solver is referenced by the checkpoint's pickle rather than a Python import.
    subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--onedir", "--noupx", "--name", "kernel-worker",
         "--log-level", "WARN", "--specpath", str(work), "--workpath", str(work / "build"),
         "--distpath", str(destination), "--paths", str(KERNEL), "--hidden-import", "solver",
         "--exclude-module", "_hashlib", "--add-binary", str(library) + ":.",
         "--add-data", str(KERNEL / "model/checkpoint.pkl") + ":model", str(ROOT / "kernel-worker.py")],
        cwd=work, env={**os.environ, "PYINSTALLER_CONFIG_DIR": str(work / "cache")}, check=True)


def include_licenses(destination, node):
    destination.mkdir()
    shutil.copyfile(ROOT / "LICENSE", destination / "Holdem-on-the-Clock.txt")
    shutil.copyfile(ROOT / "NOTICE", destination / "NOTICE.txt")
    shutil.copyfile(ROOT / "public/vendor/marked-LICENSE.md", destination / "Marked.md")
    # Official Node distributions ship all embedded third-party notices in LICENSE.
    locations = (node.parent / "LICENSE", node.parent.parent / "LICENSE",
                 node.parent.parent / "share/doc/node/LICENSE")
    node_license = next((p for p in locations if p.is_file()), None)
    if node_license is None:
        raise RuntimeError("Use an official Node distribution that includes its LICENSE file.")
    shutil.copyfile(node_license, destination / "Node.txt")
    python_licenses = (Path(sysconfig.get_path("stdlib")) / "LICENSE.txt",
                       Path(sys.base_prefix) / "LICENSE.txt")
    python_license = next(p for p in python_licenses if p.is_file())
    shutil.copyfile(python_license, destination / "Python.txt")
    package = distribution("pyinstaller")
    for path in package.files:
        if "licenses" in path.parts:
            shutil.copyfile(package.locate_file(path), destination / ("PyInstaller-" + path.name))


def build(destination):
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Choose an empty staging directory.")
    destination.mkdir(parents=True, exist_ok=True)
    node = Path(subprocess.check_output(["node", "-p", "process.execPath"], text=True).strip()).resolve()
    shutil.copy(node, destination / node.name)
    include_licenses(destination / "licenses", node)
    app = destination / "app"
    app.mkdir()
    for name in ("desktop.mjs", "server.mjs", "room.mjs", "engine.mjs", "opponents.mjs",
                 "kernel-game.mjs", "kernel-client.mjs", "package.json"):
        shutil.copyfile(ROOT / name, app / name)
    (app / "scripts").mkdir()
    shutil.copyfile(ROOT / "scripts/kernel.mjs", app / "scripts/kernel.mjs")
    shutil.copytree(ROOT / "public", app / "public", ignore=shutil.ignore_patterns(".DS_Store"),
                    copy_function=shutil.copyfile)
    with tempfile.TemporaryDirectory(prefix="holdem-freeze-") as temp:
        freeze_worker(destination, Path(temp).resolve())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path)
    build(parser.parse_args().output_dir.resolve())
