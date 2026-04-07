/** Text preprocessing endpoint. */

import { postForm } from "./client";

interface PreprocessResponse {
  original_length: number;
  processed_length: number;
  text: string;
}

export async function preprocessFile(file: File): Promise<PreprocessResponse> {
  const fd = new FormData();
  fd.append("file", file);
  return postForm<PreprocessResponse>("/preprocess/file", fd);
}
