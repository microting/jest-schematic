import { SchematicsException, Tree } from '@angular-devkit/schematics';

import { pkgJson, DeleteNodeDependency, getPackageJsonDependency } from './dependencies';

import { findPropertyInAstObject } from './json-utils';

import { get } from 'http';
import { JsonAstObject } from '@angular-devkit/core/src/json/parser_ast';
import { JsonParseMode, parseJsonAst } from '@angular-devkit/core/src/json/parser';

export interface NodePackage {
  name: string;
  version: string;
}

export enum Configs {
  JsonIndentLevel = 4,
}

export interface JestOptions {
  updateTests?: boolean;
  project?: string;
  config?: 'file' | 'packagejson' | string;
  overwrite?: boolean;
  __version__: number;
}

export function getAngularVersion(tree: Tree): number {
  const packageNode = getPackageJsonDependency(tree, '@angular/core');
  const version =
    packageNode &&
    packageNode.version
      .replace(/[~^]/, '')
      .split('.')
      .find((x) => !!parseInt(x, 10));

  return version ? +version : 0;
}

// modified version from utility/dependencies/getPackageJsonDependency
export function removePackageJsonDependency(tree: Tree, dependency: DeleteNodeDependency): void {
  const packageJsonAst = parseJsonAtPath(tree, pkgJson.Path);
  const depsNode = findPropertyInAstObject(packageJsonAst, dependency.type);
  const recorder = tree.beginUpdate(pkgJson.Path);

  if (!depsNode) {
    // Haven't found the dependencies key.
    new SchematicsException('Could not find the package.json dependency');
  } else if (depsNode.kind === 'object') {
    const fullPackageString = depsNode.text.split('\n').filter((pkg) => {
      return pkg.includes(`"${dependency.name}"`);
    })[0];

    const commaDangle = fullPackageString && fullPackageString.trim().slice(-1) === ',' ? 1 : 0;

    const packageAst = depsNode.properties.find((node) => {
      return node.key.value.toLowerCase() === dependency.name.toLowerCase();
    });

    // TODO: does this work for the last dependency?
    const newLineIndentation = 5;

    if (packageAst) {
      // Package found, remove it.
      const end = packageAst.end.offset + commaDangle;

      recorder.remove(
        packageAst.key.start.offset,
        end - packageAst.start.offset + newLineIndentation
      );
    }
  }

  tree.commitUpdate(recorder);
}

export function safeFileDelete(tree: Tree, path: string): boolean {
  if (tree.exists(path)) {
    tree.delete(path);
    return true;
  } else {
    return false;
  }
}

/**
 * Attempt to retrieve the latest package version from NPM
 * Return an optional "latest" version in case of error
 * @param packageName
 */
export function getLatestNodeVersion(packageName: string): Promise<NodePackage> {
  const DEFAULT_VERSION = 'latest';

  return new Promise((resolve) => {
    return get(`http://registry.npmjs.org/${packageName}`, (res) => {
      let rawData = '';
      res.on('data', (chunk) => (rawData += chunk));
      res.on('end', () => {
        try {
          const response = JSON.parse(rawData);
          const version = (response && response['dist-tags']) || {};

          resolve(buildPackage(packageName, version.latest));
        } catch (e) {
          resolve(buildPackage(packageName));
        }
      });
    }).on('error', () => resolve(buildPackage(packageName)));
  });

  function buildPackage(name: string, version: string = DEFAULT_VERSION): NodePackage {
    return { name, version };
  }
}

export function parseJsonAtPath(tree: Tree, path: string): JsonAstObject {
  const buffer = tree.read(path);

  if (buffer === null) {
    throw new SchematicsException('Could not read package.json.');
  }

  const content = buffer.toString();

  const json = parseJsonAst(content, JsonParseMode.CommentsAllowed);

  if (json.kind != 'object') {
    throw new SchematicsException('Invalid package.json. Was expecting an object');
  }

  return json;
}
