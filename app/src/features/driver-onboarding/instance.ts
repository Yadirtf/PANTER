// Instancias únicas del onboarding de conductor: API, cola de subida persistente y controlador.
import { httpClient, sessionManager } from '../auth/session/instance';
import { createDriversApi } from './api/drivers-api';
import { fileSystemUploader } from './native/document-uploader';
import { documentFileStore, fileQueueStore } from './native/file-stores';
import { expoNetworkMonitor } from './native/network-monitor';
import { OnboardingController } from './onboarding-controller';
import { onDriverStatusChanged } from './status/status-events';
import { UploadQueue } from './upload/upload-queue';

export const driversApi = createDriversApi(httpClient);

export const uploadQueue = new UploadQueue({
  store: fileQueueStore,
  files: documentFileStore,
  api: driversApi,
  uploader: fileSystemUploader,
  network: expoNetworkMonitor,
});

export const onboardingController = new OnboardingController({
  api: driversApi,
  uploads: uploadQueue,
});

// HU-205: primer plano, deslizar para actualizar y (en E10) la notificación push refrescan el
// estado de la solicitud.
onDriverStatusChanged(() => {
  if (sessionManager.getState().status === 'signedIn') void onboardingController.refresh();
});
