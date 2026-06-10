/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Family HQ URL - Base URL of the app, no trailing slash */
  "apiUrl": string,
  /** API Token - Personal token from Todos → Integrations (/todos/settings) */
  "apiToken": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `add-task` command */
  export type AddTask = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `add-task` command */
  export type AddTask = {}
}

