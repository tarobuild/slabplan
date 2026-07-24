import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  FilesPutFilesIdBody,
  FoldersPostJobsJobIdFoldersBody,
  FoldersPutFoldersIdBody,
  FoldersPutFoldersIdMoveBody,
} from "../src/generated/api.ts";

const readGeneratedType = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("generated file and folder body types expose validated request shapes", () => {
  const renameFile = readGeneratedType(
    "../src/generated/types/filesRenameFileSchema.ts",
  );
  const createFolder = readGeneratedType(
    "../src/generated/types/foldersFolderBodySchema.ts",
  );
  const updateFolder = readGeneratedType(
    "../src/generated/types/foldersFolderUpdateSchema.ts",
  );
  const moveFolder = readGeneratedType(
    "../src/generated/types/foldersMoveFolderSchema.ts",
  );

  assert.doesNotMatch(renameFile, /\[key: string\]: unknown;/);
  assert.match(renameFile, /originalName: string;/);

  assert.doesNotMatch(createFolder, /\[key: string\]: unknown;/);
  assert.match(createFolder, /title: string;/);
  assert.match(createFolder, /mediaType: FoldersFolderBodySchemaMediaType;/);
  assert.match(createFolder, /parentFolderId\?: string \| null;/);

  assert.doesNotMatch(updateFolder, /\[key: string\]: unknown;/);
  assert.match(updateFolder, /title\?: string;/);
  assert.match(
    updateFolder,
    /viewingPermissions\?: FoldersFolderUpdateSchemaViewingPermissions;/,
  );
  assert.match(
    updateFolder,
    /uploadingPermissions\?: FoldersFolderUpdateSchemaUploadingPermissions;/,
  );

  assert.doesNotMatch(moveFolder, /\[key: string\]: unknown;/);
  assert.match(moveFolder, /destinationFolderId\?: string \| null;/);
});

test("generated file and folder body validators reject unsupported fields", () => {
  assert.equal(
    FilesPutFilesIdBody.safeParse({ originalName: "plan.pdf", unsupported: "x" })
      .success,
    false,
  );
  assert.equal(
    FoldersPostJobsJobIdFoldersBody.safeParse({
      title: "Plans",
      mediaType: "document",
      unsupported: "x",
    }).success,
    false,
  );
  assert.equal(
    FoldersPutFoldersIdBody.safeParse({
      title: "Plans",
      unsupported: "x",
    }).success,
    false,
  );
  assert.equal(
    FoldersPutFoldersIdMoveBody.safeParse({
      destinationFolderId: null,
      unsupported: "x",
    }).success,
    false,
  );
});
