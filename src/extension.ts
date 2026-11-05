import * as vscode from 'vscode';
import { IExtensionPlugin, IDriverExtensionApi } from '@sqltools/types';
import { DRIVER_ALIASES } from './constants';
import { parseBeforeSaveConnection, parseBeforeEditConnection } from './connection';
import { downloadLatest, findManagedJar } from './h2jar';

const CMD_DOWNLOAD = 'sqltools-h2.downloadLatestJar';
const DISMISSED_KEY = 'h2.downloadPromptDismissed';

async function downloadWithProgress() {
  try {
    const r = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SQLTools H2: downloading the latest h2.jar…' },
      () => downloadLatest()
    );
    vscode.window.showInformationMessage(
      r.downloaded ? `H2 ${r.version} downloaded to ${r.path}` : `You already have the latest H2 (${r.version}).`
    );
  } catch (e) {
    vscode.window.showErrorMessage(`SQLTools H2: ${(e as Error).message}`);
  }
}

export async function activate(ctx: vscode.ExtensionContext): Promise<IDriverExtensionApi> {
  const sqltools = vscode.extensions.getExtension('mtxr.sqltools');
  if (!sqltools) throw new Error('SQLTools extension (mtxr.sqltools) is not installed');
  await sqltools.activate();
  const api = sqltools.exports;

  ctx.subscriptions.push(vscode.commands.registerCommand(CMD_DOWNLOAD, downloadWithProgress));

  // First run: offer the download button if there is no managed jar yet.
  if (!findManagedJar() && !ctx.globalState.get(DISMISSED_KEY)) {
    vscode.window
      .showInformationMessage(
        'SQLTools H2: no H2 jar installed yet. Download the latest now?',
        'Download latest',
        'Not now',
        "Don't ask again"
      )
      .then((choice) => {
        if (choice === 'Download latest') downloadWithProgress();
        else if (choice === "Don't ask again") ctx.globalState.update(DISMISSED_KEY, true);
      });
  }

  const extensionId = ctx.extension.id;
  const plugin: IExtensionPlugin = {
    extensionId,
    name: 'H2 Driver Plugin',
    type: 'driver',
    async register(extension) {
      extension.resourcesMap().set(`driver/${DRIVER_ALIASES[0].value}/icons`, {
        active: ctx.asAbsolutePath('icons/active.png'),
        default: ctx.asAbsolutePath('icons/default.png'),
        inactive: ctx.asAbsolutePath('icons/inactive.png'),
      });
      DRIVER_ALIASES.forEach(({ value }) => {
        extension.resourcesMap().set(`driver/${value}/extension-id`, extensionId);
        extension.resourcesMap().set(`driver/${value}/connection-schema`, ctx.asAbsolutePath('connection.schema.json'));
        extension.resourcesMap().set(`driver/${value}/ui-schema`, ctx.asAbsolutePath('ui.schema.json'));
      });
      await extension.client.sendRequest('ls/RegisterPlugin', {
        path: ctx.asAbsolutePath('out/ls/plugin.js'),
      });
    },
  };
  api.registerPlugin(plugin);

  return {
    driverName: 'H2',
    parseBeforeSaveConnection,
    parseBeforeEditConnection,
    driverAliases: DRIVER_ALIASES,
  };
}

export function deactivate() {}
