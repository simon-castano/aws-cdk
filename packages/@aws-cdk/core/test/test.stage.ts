import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs';
import { Test } from 'nodeunit';
import * as path from 'path';
import { App, CfnResource, Construct, IAspect, IConstruct, Stack, Stage } from '../lib';
import { toCloudFormation } from './util';

let app: App;

export = {
  'setUp'(cb: () => void) {
    app = new App();
    cb();
  },

  'tearDown'(cb: () => void) {
    rimraf(app.assemblyBuilder.outdir);
    cb();
  },

  'Stack inherits unspecified part of the env from Stage'(test: Test) {
    // GIVEN
    const stage = new Stage(app, 'Stage', {
      env: { account: 'account', region: 'region' },
    });

    // WHEN
    const stack1 = new Stack(stage, 'Stack1', { env: { region: 'elsewhere' } });
    const stack2 = new Stack(stage, 'Stack2', { env: { account: 'tnuocca' } });

    // THEN
    test.deepEqual([stack1.account, stack1.region], ['account', 'elsewhere']);
    test.deepEqual([stack2.account, stack2.region], ['tnuocca', 'region']);

    test.done();
  },

  'The Stage Assembly is in the app Assembly\'s manifest'(test: Test) {
    // WHEN
    const stage = new Stage(app, 'Stage');
    new BogusStack(stage, 'Stack2');

    // THEN -- app manifest contains an embedded cloud assembly
    const appAsm = app.synth();

    const artifact = appAsm.artifacts.find(isEmbeddedCloudAssemblyArtifact);
    test.ok(artifact);

    test.done();
  },

  'Stacks in Stage are in a different cxasm than Stacks in App'(test: Test) {
    // WHEN
    const stack1 = new BogusStack(app, 'Stack1');
    const stage = new Stage(app, 'Stage');
    const stack2 = new BogusStack(stage, 'Stack2');

    // THEN
    const stageAsm = stage.synth();
    test.deepEqual(stageAsm.stacks.map(s => s.stackName), [stack2.stackName]);

    const appAsm = app.synth();
    test.deepEqual(appAsm.stacks.map(s => s.stackName), [stack1.stackName]);

    test.done();
  },

  'Default stack name in Stage objects incorporates the Stage name and no hash'(test: Test) {
    // WHEN
    const stage = new Stage(app, 'MyStage');
    const stack = new BogusStack(stage, 'MyStack');

    // THEN
    test.equal(stage.stageName, 'MyStage');
    test.equal(stack.stackName, 'MyStage-MyStack');

    test.done();
  },

  'Can not have dependencies to stacks outside the embedded asm'(test: Test) {
    // GIVEN
    const stack1 = new BogusStack(app, 'Stack1');
    const stage = new Stage(app, 'MyStage');
    const stack2 = new BogusStack(stage, 'Stack2');

    // WHEN
    test.throws(() => {
      stack2.addDependency(stack1);
    }, /dependency cannot cross stage boundaries/);

    test.done();
  },

  'When we synth() a stage, prepare must be called on constructs in the stage'(test: Test) {
    // GIVEN
    let prepared = false;
    const stage = new Stage(app, 'MyStage');
    const stack = new BogusStack(stage, 'Stack');
    class HazPrepare extends Construct {
      protected prepare() {
        prepared = true;
      }
    }
    new HazPrepare(stack, 'Preparable');

    // WHEN
    stage.synth();

    // THEN
    test.equals(prepared, true);

    test.done();
  },

  'When we synth() a stage, aspects inside it must have been applied'(test: Test) {
    // GIVEN
    const stage = new Stage(app, 'MyStage');
    const stack = new BogusStack(stage, 'Stack');

    // WHEN
    stack.node.applyAspect(new TouchingAspect());

    // THEN
    test.deepEqual(toCloudFormation(stack), {
      Resources: {
        Resource: {
          Type: 'CDK::TEST::TOUCHED',
        },
      },
    });

    test.done();
  },

  'Aspects do not apply inside a Stage'(test: Test) {
    // GIVEN
    const stage = new Stage(app, 'MyStage');
    const stack = new BogusStack(stage, 'Stack');

    // WHEN
    app.node.applyAspect(new TouchingAspect());

    // THEN
    test.deepEqual(toCloudFormation(stack), {
      Resources: {
        Resource: {
          Type: 'CDK::Test::Resource',
        },
      },
    });

    test.done();
  },

  'Automatic dependencies inside a stage are available immediately after synth'(test: Test) {
    // GIVEN
    const stage = new Stage(app, 'MyStage');
    const stack1 = new Stack(stage, 'Stack1');
    const stack2 = new Stack(stage, 'Stack2');

    // WHEN
    const resource1 = new CfnResource(stack1, 'Resource', {
      type: 'CDK::Test::Resource',
    });
    new CfnResource(stack2, 'Resource', {
      type: 'CDK::Test::Resource',
      properties: {
        OtherThing: resource1.ref,
      },
    });

    const asm = stage.synth();

    // THEN
    test.deepEqual(
      asm.getStackArtifact(stack2.artifactId).dependencies.map(d => d.id),
      [stack1.artifactId]);

    test.done();
  },
};

class TouchingAspect implements IAspect {
  public visit(node: IConstruct): void {
    if (node instanceof CfnResource) {
      node.addOverride('Type', 'CDK::TEST::TOUCHED');
    }
  }
}

/**
 * rm -rf reimplementation, don't want to depend on an NPM package for this
 */
function rimraf(fsPath: string) {
  try {
    const isDir = fs.lstatSync(fsPath).isDirectory();

    if (isDir) {
      for (const file of fs.readdirSync(fsPath)) {
        rimraf(path.join(fsPath, file));
      }
      fs.rmdirSync(fsPath);
    } else {
      fs.unlinkSync(fsPath);
    }
  } catch (e) {
    // We will survive ENOENT
    if (e.code !== 'ENOENT') { throw e; }
  }
}

class BogusStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new CfnResource(this, 'Resource', {
      type: 'CDK::Test::Resource',
    });
  }
}

function isEmbeddedCloudAssemblyArtifact(a: any): a is cxapi.EmbeddedCloudAssemblyArtifact {
  return a instanceof cxapi.EmbeddedCloudAssemblyArtifact;
}