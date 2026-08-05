import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Optional

from edi_engine.engine import ProcessResult, process


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("EDIWorkbench")
        self.geometry("560x260")
        self.resizable(False, False)

        self.selected_path: Optional[Path] = None
        self._build_ui()

    def _build_ui(self):
        pad = {"padx": 12, "pady": 8}
        frame = ttk.Frame(self)
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="837 EDI file:").grid(row=0, column=0, sticky="w", **pad)
        self.path_var = tk.StringVar()
        entry = ttk.Entry(frame, textvariable=self.path_var, width=52, state="readonly")
        entry.grid(row=0, column=1, **pad)
        ttk.Button(frame, text="Browse...", command=self._browse).grid(row=0, column=2, **pad)

        self.process_btn = ttk.Button(frame, text="Process", command=self._process, state="disabled")
        self.process_btn.grid(row=1, column=1, **pad)

        self.status_var = tk.StringVar(value="Select a file to begin.")
        ttk.Label(
            frame, textvariable=self.status_var, wraplength=500, justify="left", foreground="#333"
        ).grid(row=2, column=0, columnspan=3, sticky="w", **pad)

    def _browse(self):
        path = filedialog.askopenfilename(
            title="Select an EDI 837 file",
            filetypes=[("EDI files", "*.edi *.837 *.txt"), ("All files", "*.*")],
        )
        if not path:
            return
        self.selected_path = Path(path)
        self.path_var.set(path)
        self.process_btn.config(state="normal")
        self.status_var.set("Ready to process.")

    def _process(self):
        if not self.selected_path:
            return
        try:
            result: ProcessResult = process(self.selected_path)
        except Exception as exc:  # surface any parse/IO failure to the user, don't crash the app
            messagebox.showerror("Processing failed", str(exc))
            self.status_var.set(f"Failed: {exc}")
            return

        summary_lines = "\n".join(f"  {name}: {count}" for name, count in result.rule_summary.items())
        self.status_var.set(
            f"Done. {result.segments_changed} segment(s) updated.\n"
            f"{summary_lines}\n"
            f"Output: {result.output_path.name}"
        )
        messagebox.showinfo("Success", f"Wrote:\n{result.output_path}")


def main():
    App().mainloop()


if __name__ == "__main__":
    main()
