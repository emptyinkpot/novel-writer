import type { DataBasePublicationClient } from '../../infrastructure/database/DataBasePublicationClient.js';

export class AccountService {
  constructor(private readonly database: DataBasePublicationClient) {}

  listAccounts() {
    return this.database.listFanqieAccounts();
  }
}
