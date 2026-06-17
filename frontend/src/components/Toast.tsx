import { createContext, useContext, useState, useCallback, ReactNode } from "react";

type Toast = { msg: string; type: "ok" | "err" | "info" };
const Ctx = createContext<(msg: string, type?: Toast["type"]) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback((msg: string, type: Toast["type"] = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.type === "ok" ? "ok" : toast.type === "err" ? "err" : ""}`}>
          {toast.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}
