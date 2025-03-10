// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ConfigurationChangeEvent, ConfigurationScope, WorkspaceConfiguration, WorkspaceFolder } from 'vscode';
import { traceLog } from './logging';
import { getInterpreterDetails } from './python';
import { getConfiguration, getWorkspaceFolders } from './vscodeapi';

const DEFAULT_SEVERITY: Record<string, string> = {
    convention: 'Information',
    error: 'Error',
    fatal: 'Error',
    refactor: 'Hint',
    warning: 'Warning',
    info: 'Information',
};
export interface ISettings {
    cwd: string;
    workspace: string;
    args: string[];
    severity: Record<string, string>;
    path: string[];
    interpreter: string[];
    importStrategy: string;
    showNotifications: string;
    extraPaths: string[];
}

export function getExtensionSettings(namespace: string, includeInterpreter?: boolean): Promise<ISettings[]> {
    return Promise.all(getWorkspaceFolders().map((w) => getWorkspaceSettings(namespace, w, includeInterpreter)));
}

function resolveVariables(value: string[], workspace?: WorkspaceFolder): string[] {
    const substitutions = new Map<string, string>();
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
        substitutions.set('${userHome}', home);
    }
    if (workspace) {
        substitutions.set('${workspaceFolder}', workspace.uri.fsPath);
    }
    substitutions.set('${cwd}', process.cwd());
    getWorkspaceFolders().forEach((w) => {
        substitutions.set('${workspaceFolder:' + w.name + '}', w.uri.fsPath);
    });

    return value.map((s) => {
        for (const [key, value] of substitutions) {
            s = s.replace(key, value);
        }
        return s;
    });
}

function getArgs(namespace: string, workspace: WorkspaceFolder): string[] {
    const config = getConfiguration(namespace, workspace.uri);
    const args = config.get<string[]>('args', []);

    if (args.length > 0) {
        return args;
    }

    const legacyConfig = getConfiguration('python', workspace.uri);
    const legacyArgs = legacyConfig.get<string[]>('linting.pylintArgs', []);
    if (legacyArgs.length > 0) {
        traceLog('Using legacy Pylint args from `python.linting.pylintArgs`');
        return legacyArgs;
    }

    return [];
}

function getPath(namespace: string, workspace: WorkspaceFolder): string[] {
    const config = getConfiguration(namespace, workspace.uri);
    const path = config.get<string[]>('path', []);

    if (path.length > 0) {
        return path;
    }

    const legacyConfig = getConfiguration('python', workspace.uri);
    const legacyPath = legacyConfig.get<string>('linting.pylintPath', '');
    if (legacyPath.length > 0 && legacyPath !== 'pylint') {
        traceLog('Using legacy Pylint path from `python.linting.pylintPath`');
        return [legacyPath];
    }
    return [];
}

function getCwd(_namespace: string, workspace: WorkspaceFolder): string {
    const legacyConfig = getConfiguration('python', workspace.uri);
    const legacyCwd = legacyConfig.get<string>('linting.cwd');

    if (legacyCwd) {
        traceLog('Using cwd from `python.linting.cwd`.');
        return resolveVariables([legacyCwd], workspace)[0];
    }

    return workspace.uri.fsPath;
}

function getExtraPaths(_namespace: string, workspace: WorkspaceFolder): string[] {
    const legacyConfig = getConfiguration('python', workspace.uri);
    const legacyExtraPaths = legacyConfig.get<string[]>('analysis.extraPaths', []);

    if (legacyExtraPaths.length > 0) {
        traceLog('Using cwd from `python.analysis.extraPaths`.');
    }
    return legacyExtraPaths;
}

export function getInterpreterFromSetting(namespace: string, scope?: ConfigurationScope) {
    const config = getConfiguration(namespace, scope);
    return config.get<string[]>('interpreter');
}

export async function getWorkspaceSettings(
    namespace: string,
    workspace: WorkspaceFolder,
    includeInterpreter?: boolean,
): Promise<ISettings> {
    const config = getConfiguration(namespace, workspace.uri);

    let interpreter: string[] = [];
    if (includeInterpreter) {
        interpreter = getInterpreterFromSetting(namespace, workspace) ?? [];
        if (interpreter.length === 0) {
            interpreter = (await getInterpreterDetails(workspace.uri)).path ?? [];
        }
    }

    const args = getArgs(namespace, workspace);
    const path = getPath(namespace, workspace);
    const extraPaths = getExtraPaths(namespace, workspace);
    const workspaceSetting = {
        cwd: getCwd(namespace, workspace),
        workspace: workspace.uri.toString(),
        args: resolveVariables(args, workspace),
        severity: config.get<Record<string, string>>('severity', DEFAULT_SEVERITY),
        path: resolveVariables(path, workspace),
        interpreter: resolveVariables(interpreter, workspace),
        importStrategy: config.get<string>('importStrategy', 'useBundled'),
        showNotifications: config.get<string>('showNotifications', 'off'),
        extraPaths: resolveVariables(extraPaths, workspace),
    };
    return workspaceSetting;
}

function getGlobalValue<T>(config: WorkspaceConfiguration, key: string, defaultValue: T): T {
    const inspect = config.inspect<T>(key);
    return inspect?.globalValue ?? inspect?.defaultValue ?? defaultValue;
}

export async function getGlobalSettings(namespace: string, includeInterpreter?: boolean): Promise<ISettings> {
    const config = getConfiguration(namespace);

    let interpreter: string[] | undefined = [];
    if (includeInterpreter) {
        interpreter = getGlobalValue<string[]>(config, 'interpreter', []);
        if (interpreter === undefined || interpreter.length === 0) {
            interpreter = (await getInterpreterDetails()).path;
        }
    }

    const setting = {
        cwd: process.cwd(),
        workspace: process.cwd(),
        args: getGlobalValue<string[]>(config, 'args', []),
        severity: getGlobalValue<Record<string, string>>(config, 'severity', DEFAULT_SEVERITY),
        path: getGlobalValue<string[]>(config, 'path', []),
        interpreter: interpreter ?? [],
        importStrategy: getGlobalValue<string>(config, 'importStrategy', 'fromEnvironment'),
        showNotifications: getGlobalValue<string>(config, 'showNotifications', 'off'),
        extraPaths: getGlobalValue<string[]>(config, 'extraPaths', []),
    };
    return setting;
}

export function isLintOnChangeEnabled(namespace: string): boolean {
    const config = getConfiguration(namespace);
    return config.get<boolean>('lintOnChange', false);
}

export function checkIfConfigurationChanged(e: ConfigurationChangeEvent, namespace: string): boolean {
    const settings = [
        `${namespace}.args`,
        `${namespace}.severity`,
        `${namespace}.path`,
        `${namespace}.interpreter`,
        `${namespace}.importStrategy`,
        `${namespace}.showNotifications`,
    ];
    const changed = settings.map((s) => e.affectsConfiguration(s));
    return changed.includes(true);
}
