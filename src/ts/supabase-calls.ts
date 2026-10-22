import { Node, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import {
  enclosingFunction,
  functionName,
  lineCol,
  outermostFunction,
  stringArg,
  unwrap,
} from './ast-utils.js';

export type SupabaseCallKind =
  | 'getSession'
  | 'getUser'
  | 'getClaims'
  | 'rpc'
  | 'storageUpload'
  | 'createClient'
  | 'fromMutation'
  | 'setSession';

export interface SupabaseCall {
  kind: SupabaseCallKind;
  node: Node;
  file: string;
  line: number;
  column: number;
  fnName?: string;
  receiverText: string;
  rpcName?: string;
  bucket?: string;
  storageOp?: string;
  table?: string;
  op?: string;
  clientFn?: string;
  /** createClient: true when its arguments reference the service role key. */
  serviceRole?: boolean;
}

const AUTH_METHODS = new Set(['getSession', 'getUser', 'getClaims', 'setSession']);
const STORAGE_WRITE_OPS = new Set(['upload', 'update', 'remove', 'move', 'copy']);
const DB_OPS = new Set(['select', 'insert', 'update', 'delete', 'upsert']);
const CLIENT_FACTORIES = new Set(['createClient', 'createServerClient', 'createBrowserClient']);
export const SERVICE_ROLE_RE = /service[_-]?role|service[_-]?key/i;
const ADMIN_NAME_RE = /admin|service[_-]?role|serviceclient|servicesupabase/i;

function isSupabaseModule(spec: string): boolean {
  return spec.includes('@supabase/supabase-js') || spec.includes('@supabase/ssr');
}

interface SupabaseImports {
  named: Map<string, string>; // local name -> factory name
  namespaces: Set<string>;
}

function supabaseImports(sf: SourceFile): SupabaseImports {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const decl of sf.getImportDeclarations()) {
    if (!isSupabaseModule(decl.getModuleSpecifierValue())) continue;
    for (const spec of decl.getNamedImports()) {
      const imported = spec.getName();
      if (CLIENT_FACTORIES.has(imported)) named.set(spec.getAliasNode()?.getText() ?? imported, imported);
    }
    const ns = decl.getNamespaceImport();
    if (ns) namespaces.add(ns.getText());
  }
  return { named, namespaces };
}

function isAuthAccess(recv: Node): boolean {
  return Node.isPropertyAccessExpression(recv) && recv.getName() === 'auth';
}

function isStorageFrom(recv: Node): { bucket: string | undefined } | null {
  if (!Node.isCallExpression(recv)) return null;
  const callee = recv.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'from') return null;
  const inner = callee.getExpression();
  if (!Node.isPropertyAccessExpression(inner) || inner.getName() !== 'storage') return null;
  return { bucket: stringArg(recv, 0) };
}

function isDbFrom(recv: Node): { table: string | undefined; receiver: Node } | null {
  if (!Node.isCallExpression(recv)) return null;
  const callee = recv.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'from') return null;
  const inner = callee.getExpression();
  if (Node.isPropertyAccessExpression(inner) && inner.getName() === 'storage') return null;
  return { table: stringArg(recv, 0), receiver: inner };
}

export function findSupabaseCalls(file: string, sf: SourceFile): SupabaseCall[] {
  const calls: SupabaseCall[] = [];
  const imports = supabaseImports(sf);

  const base = (kind: SupabaseCallKind, node: CallExpression, receiverText: string): SupabaseCall => {
    const { line, column } = lineCol(node);
    const fn = enclosingFunction(node);
    const call: SupabaseCall = { kind, node, file, line, column, receiverText };
    const name = fn ? functionName(fn) : undefined;
    if (name) call.fnName = name;
    return call;
  };

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (Node.isPropertyAccessExpression(callee)) {
      const name = callee.getName();
      const recv = callee.getExpression();
      if (AUTH_METHODS.has(name) && isAuthAccess(recv)) {
        calls.push(base(name as SupabaseCallKind, call, recv.getText()));
      } else if (name === 'rpc') {
        const rpcName = stringArg(call, 0);
        if (rpcName !== undefined) {
          const c = base('rpc', call, recv.getText());
          c.rpcName = rpcName;
          calls.push(c);
        }
      } else if (STORAGE_WRITE_OPS.has(name) || DB_OPS.has(name)) {
        const st = STORAGE_WRITE_OPS.has(name) ? isStorageFrom(recv) : null;
        if (st) {
          const c = base('storageUpload', call, recv.getText());
          c.storageOp = name;
          if (st.bucket !== undefined) c.bucket = st.bucket;
          calls.push(c);
        } else if (DB_OPS.has(name)) {
          const db = isDbFrom(recv);
          if (db) {
            const c = base('fromMutation', call, db.receiver.getText());
            c.op = name;
            if (db.table !== undefined) c.table = db.table;
            calls.push(c);
          }
        }
      } else if (
        CLIENT_FACTORIES.has(name) &&
        Node.isIdentifier(recv) &&
        imports.namespaces.has(recv.getText())
      ) {
        const c = base('createClient', call, '');
        c.clientFn = name;
        c.serviceRole = call.getArguments().some((a) => SERVICE_ROLE_RE.test(a.getText()));
        calls.push(c);
      }
    } else if (Node.isIdentifier(callee)) {
      const factory = imports.named.get(callee.getText());
      if (factory) {
        const c = base('createClient', call, '');
        c.clientFn = factory;
        c.serviceRole = call.getArguments().some((a) => SERVICE_ROLE_RE.test(a.getText()));
        calls.push(c);
      }
    }
  }
  return calls;
}

// ---- admin (service_role) client tracking ----

export interface AdminDecl {
  name: string;
  scope: Node;
}

function isAdminFactoryCall(call: CallExpression, createClientNodes: Set<Node>): boolean {
  if (createClientNodes.has(call)) {
    return call.getArguments().some((a) => SERVICE_ROLE_RE.test(a.getText()));
  }
  const callee = call.getExpression();
  const name = Node.isIdentifier(callee)
    ? callee.getText()
    : Node.isPropertyAccessExpression(callee)
      ? callee.getName()
      : '';
  return name !== '' && ADMIN_NAME_RE.test(name);
}

export interface AdminIndex {
  isAdminReceiver(receiver: Node): boolean;
}

export function buildAdminIndex(sf: SourceFile, calls: SupabaseCall[]): AdminIndex {
  const createNodes = new Set<Node>(calls.filter((c) => c.kind === 'createClient').map((c) => c.node));
  const decls: AdminDecl[] = [];
  const importedAdmin = new Set<string>();

  for (const imp of sf.getImportDeclarations()) {
    for (const n of imp.getNamedImports()) {
      const local = n.getAliasNode()?.getText() ?? n.getName();
      if (ADMIN_NAME_RE.test(local) && !imp.isTypeOnly() && !n.isTypeOnly()) importedAdmin.add(local);
    }
    const def = imp.getDefaultImport();
    if (def && ADMIN_NAME_RE.test(def.getText()) && !imp.isTypeOnly()) importedAdmin.add(def.getText());
  }

  const scopeOf = (n: Node): Node => outermostFunction(n) ?? sf;
  const register = (name: string, init: Node, at: Node): void => {
    const e = unwrap(init);
    if (Node.isCallExpression(e) && isAdminFactoryCall(e, createNodes))
      decls.push({ name, scope: scopeOf(at) });
  };

  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer();
    if (init && Node.isIdentifier(vd.getNameNode())) register(vd.getName(), init, vd);
  }
  for (const bin of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() === SyntaxKind.EqualsToken && Node.isIdentifier(bin.getLeft())) {
      register(bin.getLeft().getText(), bin.getRight(), bin);
    }
  }

  return {
    isAdminReceiver(receiver: Node): boolean {
      const e = unwrap(receiver);
      if (Node.isIdentifier(e)) {
        const name = e.getText();
        if (importedAdmin.has(name)) return true;
        return decls.some(
          (d) => d.name === name && e.getStart() >= d.scope.getStart() && e.getEnd() <= d.scope.getEnd(),
        );
      }
      if (Node.isCallExpression(e)) return isAdminFactoryCall(e, createNodes);
      if (Node.isPropertyAccessExpression(e)) return ADMIN_NAME_RE.test(e.getName());
      return false;
    },
  };
}
