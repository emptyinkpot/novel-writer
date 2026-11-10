import type { LocalPublicationStore } from '../../infrastructure/local/LocalPublicationStore.js';

export class AccountService {
  constructor(private readonly database: LocalPublicationStore) {}

  listAccounts() {
    return this.database.listFanqieAccounts();
  }
}
