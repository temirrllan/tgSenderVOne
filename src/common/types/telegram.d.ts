// backend/src/common/types/telegram.d.ts

declare module 'telegram/sessions' {
  export class StringSession {
    constructor(session?: string);
    save(): string;
  }
}

declare module 'telegram/tl' {
  export namespace Api {
    export class User {
      id: any;
      username?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
    }

    export namespace account {
      export class UpdateProfile {
        constructor(params: {
          firstName?: string;
          lastName?: string;
          about?: string;
        });
      }
    }

    export namespace photos {
      export class UploadProfilePhoto {
        constructor(params: {
          file: any;
        });
      }
    }

    export namespace messages {
      export class ImportChatInvite {
        constructor(params: {
          hash: string;
        });
      }
    }
  }
}

// Дополнительные типы для работы с файлами
declare module 'telegram' {
  export interface CustomFile {
    name: string;
    size: number;
    buffer: Buffer;
  }

  export interface UploadFileParams {
    file: Buffer | File | CustomFile;
    workers?: number;
  }

  export class TelegramClient {
    constructor(
      session: any,
      apiId: number,
      apiHash: string,
      options?: {
        connectionRetries?: number;
        [key: string]: any;
      }
    );

    connect(): Promise<void>;
    disconnect(): Promise<void>;
    start(options: {
      phoneNumber: () => Promise<string> | string;
      password?: () => Promise<string> | string;
      phoneCode?: () => Promise<string> | string;
      onError?: (err: any) => void;
    }): Promise<void>;
    getMe(): Promise<any>;
    sendMessage(entity: any, options: { message: string }): Promise<any>;
    invoke(request: any): Promise<any>;
    uploadFile(params: UploadFileParams): Promise<any>;
  }
}