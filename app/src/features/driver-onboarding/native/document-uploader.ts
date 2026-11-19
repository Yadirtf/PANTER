// PUT del archivo a la URL firmada con UploadTask de expo-file-system: sube el binario tal cual
// (sin multipart), con el content-type exacto que pidió la API y con progreso.
import { File, type UploadResult, UploadType } from 'expo-file-system';
import { networkError } from '../../../shared/api/errors';
import { parsePutResponse } from '../upload/put-response';
import type { DocumentUploader } from '../upload/upload-types';

export const fileSystemUploader: DocumentUploader = {
  async put({ url, fileUri, headers, onProgress, signal }) {
    const task = new File(fileUri).createUploadTask(url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers,
      mimeType: headers['content-type'],
      sessionType: 'foreground',
      signal,
      onProgress: ({ bytesSent, totalBytes }) => {
        if (totalBytes > 0) onProgress(bytesSent / totalBytes);
      },
    });
    let result: UploadResult;
    try {
      result = await task.uploadAsync();
    } catch (error) {
      // Solo rechaza si no hubo respuesta HTTP (sin red, cancelado o archivo ilegible).
      throw networkError(error);
    } finally {
      task.release();
    }
    return parsePutResponse(result.status, result.body);
  },
};
