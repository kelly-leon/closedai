"use client";

import { DragEvent, useEffect, useRef, useState } from "react";
import { supabaseAuthEnabled } from "../lib/supabase";
import { invalidateShared, sharedGet } from "../lib/sharedData";
import { invalidateQuery } from "../lib/query";
import { api, ApiError, DocumentItem } from "../lib/api";

export interface UploadState { name: string; progress: number; file?: File; preview?: string; error?: string; retryable?: boolean }

const allowed = new Set(["pdf", "docx", "txt", "md", "jpg", "jpeg", "png", "webp"]);
const maxBytes = 50 * 1024 * 1024;
const imageMaxBytes = 5 * 1024 * 1024;

export function useDocumentUploader(unitId: string) {
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  async function load(force = false) {
    if (!unitId) {
      setDocuments([]);
      setLoading(false);
      return;
    }
    if (force) invalidateShared(`documents:${unitId}`);
    setLoading(true);
    try {
      const items = await sharedGet<DocumentItem[]>(`documents:${unitId}`, () => api.documents(unitId));
      setDocuments(items);
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught instanceof ApiError ? caught : new ApiError("We couldn't load your documents. Retry"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(Boolean(unitId));
    setLoadError(null);
    void load();
    const refresh = () => void load();
    window.addEventListener("closedai:document-changed", refresh);
    return () => window.removeEventListener("closedai:document-changed", refresh);
  }, [unitId]);

  useEffect(() => {
    if (!documents.some(document => document.status === "pending" || document.status === "processing")) return;
    const timer = window.setInterval(() => {
      invalidateShared(`documents:${unitId}`);
      invalidateQuery(`documents:${unitId}`);
      void load(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [documents, unitId]);

  function refreshAfterChange() {
    invalidateShared(`documents:${unitId}`);
    invalidateQuery(`documents:${unitId}`);
    invalidateQuery("usage");
    window.dispatchEvent(new Event("closedai:document-changed"));
    void load(true);
  }

  async function upload(files: File[]) {
    if (!unitId) return;
    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isImage = ["jpg", "jpeg", "png", "webp"].includes(extension);
      const validation = !allowed.has(extension)
        ? "Unsupported file type."
        : file.size > maxBytes
          ? "File is larger than 50 MB."
          : isImage && file.size > imageMaxBytes
            ? "Image is larger than 5 MB."
            : null;
      if (validation) {
        setUploads(current => [...current, { name: file.name, progress: 0, error: validation }]);
        continue;
      }
      setUploads(current => [...current, {
        name: file.name, progress: 0, file,
        preview: isImage ? URL.createObjectURL(file) : undefined,
      }]);
      try {
        if (supabaseAuthEnabled) {
          const signed = await api.uploadDocumentUrl(file, unitId);
          await api.uploadSignedDocument(signed.upload_url, file, progress =>
            setUploads(current => current.map(item => item.name === file.name ? { ...item, progress } : item)));
          await api.registerHostedDocument(signed.storage_path, file, unitId);
        } else {
          await api.uploadDocument(file, unitId, progress =>
            setUploads(current => current.map(item => item.name === file.name ? { ...item, progress } : item)));
        }
        refreshAfterChange();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed.";
        if ((error instanceof ApiError && error.code === "limit_reached") || /limit|quota|upgrade/i.test(message)) setLimitReached(true);
        const retryable = supabaseAuthEnabled && /uploaded to storage/i.test(message);
        setUploads(current => current.map(item => item.name === file.name ? { ...item, error: message, retryable } : item));
      }
    }
  }

  async function retryUpload(item: UploadState) {
    if (!item.file) return;
    setUploads(current => current.filter(upload => upload !== item));
    await upload([item.file]);
  }

  async function retryDocument(id: string) {
    await api.retryDocument(id);
    refreshAfterChange();
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void upload(Array.from(event.dataTransfer.files));
  }

  async function remove(id: string) {
    await api.deleteDocument(id);
    refreshAfterChange();
  }

  return {
    input, uploads, documents, loading, loadError, limitReached, upload, retryUpload,
    retryDocument, drop, remove, openPicker: () => input.current?.click(), load, refreshAfterChange,
  };
}
