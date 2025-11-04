declare module 'grammy/web' {
  export * from 'grammy';
  import type { InlineKeyboardButton, InlineKeyboardMarkup } from '@grammyjs/types';

  export class InlineKeyboard implements InlineKeyboardMarkup {
    inline_keyboard: InlineKeyboardButton[][];
    constructor();
    text(text: string, data: string): this;
    url(text: string, url: string): this;
    webApp(text: string, url: string): this;
    row(): this;
    add(...buttons: InlineKeyboardButton[]): this;
    static text(text: string, data: string): InlineKeyboardButton;
    static url(text: string, url: string): InlineKeyboardButton;
  }

  export function webhookCallback(
    bot: any,
    adapterName: string,
    onTimeout?: string,
    timeoutMilliseconds?: number
  ): (request: Request) => Promise<Response>;
}
