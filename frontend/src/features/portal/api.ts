export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api/backend/portal/${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });
  const payload = (await response.json()) as T & {
    message?: string | string[];
  };
  if (!response.ok)
    throw new Error(
      Array.isArray(payload.message)
        ? payload.message.join("\n")
        : (payload.message ?? "The request failed. Try again."),
    );
  return payload;
}
export async function download(path: string, filename: string, body?: unknown) {
  const response = await fetch(`/api/backend/portal/${path}`, {
    method: body ? "POST" : "GET",
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }
      : {}),
  });
  if (!response.ok) {
    const error = (await response.json()) as { message?: string };
    throw new Error(error.message ?? "Export failed.");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function fileBody(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 6_000_000)
    throw new Error("Choose an .xlsx file smaller than 6 MB.");
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
  return { filename: file.name, base64 };
}
