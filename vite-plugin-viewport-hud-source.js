import path from 'node:path';

/**
 * Development-only Babel transform used by the Viewport HUD demo.
 * It stamps each native JSX element with its project-relative source location.
 */
export default function viewportHudSourcePlugin({ types: t }) {
  return {
    name: 'viewport-hud-source-markers',
    visitor: {
      JSXOpeningElement(elementPath, state) {
        const tagName = elementPath.node.name;
        if (tagName.type !== 'JSXIdentifier' || !/^[a-z]/.test(tagName.name)) return;

        const sourceFile = state.filename || state.file?.opts?.filename;
        const root = state.opts.root;
        const line = elementPath.node.loc?.start.line;
        if (!sourceFile || !root || !line) return;

        const attributes = elementPath.node.attributes;
        const hasAttribute = (name) => attributes.some(
          (attribute) => attribute.type === 'JSXAttribute' && attribute.name.name === name,
        );
        const relativeFile = path.relative(root, sourceFile).split(path.sep).join('/');

        if (!hasAttribute('data-source')) {
          attributes.push(
            t.jsxAttribute(t.jsxIdentifier('data-source'), t.stringLiteral(`${relativeFile}:${line}`)),
          );
        }
        if (!hasAttribute('data-inspector-line')) {
          attributes.push(
            t.jsxAttribute(t.jsxIdentifier('data-inspector-line'), t.stringLiteral(String(line))),
          );
        }

        const componentName = findOwningComponentName(elementPath);
        if (componentName && !hasAttribute('data-component')) {
          attributes.push(
            t.jsxAttribute(t.jsxIdentifier('data-component'), t.stringLiteral(componentName)),
          );
        }
      },
    },
  };
}

function findOwningComponentName(elementPath) {
  for (let current = elementPath.parentPath; current; current = current.parentPath) {
    if (current.isFunctionDeclaration()) return current.node.id?.name || null;
    if (current.isVariableDeclarator() && current.node.id.type === 'Identifier') return current.node.id.name;
  }
  return null;
}
