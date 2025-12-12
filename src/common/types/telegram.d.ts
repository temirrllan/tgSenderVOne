// backend/src/common/types/telegram.d.ts

declare module 'telegram/sessions/index.js' {
  export class StringSession {
    constructor(session?: string);
    save(): string;
  }
}

declare module 'telegram/tl/index.js' {
  export namespace Api {
    export class User {
      id: bigInt.BigInteger;
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