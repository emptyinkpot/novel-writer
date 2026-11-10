import type { RemoteScanService } from '../scan/RemoteScanService.js';
import type { SyncRemoteChaptersInput } from '../../sdk/types.js';

export class RemoteChapterTool {
  constructor(private readonly scan: RemoteScanService) {}

  syncRemoteChapters(input: SyncRemoteChaptersInput) {
    return this.scan.syncRemoteChapters(input);
  }
}
