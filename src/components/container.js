import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { Context } from '../context';
import { StoreRegistry, bindAction, bindActions } from '../store';
import shallowEqual from '../utils/shallow-equal';

const noop = () => () => {};

export default class Container extends Component {
  static propTypes = {
    children: PropTypes.node,
    scope: PropTypes.string,
    isGlobal: PropTypes.bool,
  };

  static storeType = null;
  static hooks = null;
  static contextType = Context;

  static getDerivedStateFromProps(nextProps, prevState) {
    const { scope } = nextProps;
    const hasScopeChanged = scope !== prevState.scope;

    let nextState = null;
    if (hasScopeChanged) {
      const actions = prevState.bindContainerActions(scope);
      nextState = {
        scope,
        scopedActions: actions,
        // create a new api object so consumers below re-render
        api: { ...prevState.api },
      };
    }
    // We trigger the action here so subscribers get new values ASAP
    prevState.triggerContainerAction(nextProps);
    return nextState;
  }

  constructor(props, context) {
    super(props, context);
    this.registry = new StoreRegistry('__local__');

    this.state = {
      api: {
        globalRegistry: this.context.globalRegistry,
        getStore: (Store, scope) =>
          this.getScopedStore(Store, scope) || this.context.getStore(Store),
      },
      // stored to make them available in getDerivedStateFromProps
      // as js context there is null https://github.com/facebook/react/issues/12612
      bindContainerActions: this.bindContainerActions,
      triggerContainerAction: this.triggerContainerAction,
      scope: props.scope,
    };
    this.state.scopedActions = this.bindContainerActions(props.scope);
  }

  componentDidUpdate(prevProps) {
    if (this.props.scope !== prevProps.scope) {
      // Check if instance has still subscribers, if not delete
      this.deleteScopedStore(prevProps.scope);
    }
  }

  componentWillUnmount() {
    this.deleteScopedStore();
  }

  bindContainerActions = scope => {
    const { storeType, hooks } = this.constructor;
    const { api } = this.state;
    // we explicitly pass scope as it might be changed
    const { storeState } = api.getStore(storeType, scope);

    const actions = bindActions(
      storeType.actions,
      storeState,
      this.getContainerProps
    );
    this.onInit = bindAction(
      storeState,
      hooks.onInit,
      'onInit',
      this.getContainerProps,
      actions
    );
    this.onUpdate = bindAction(
      storeState,
      hooks.onUpdate,
      'onUpdate',
      this.getContainerProps,
      actions
    );
    // make sure we also reset actionProps
    this.actionProps = null;
    return actions;
  };

  triggerContainerAction = nextProps => {
    // eslint-disable-next-line no-unused-vars
    const { children, scope, isGlobal, ...restProps } = nextProps;
    if (shallowEqual(this.actionProps, restProps)) return;

    // store restProps on instance so we can diff and use fresh props
    // in actions even before react sets them in this.props
    this.actionProps = restProps;

    if (this.onInit) {
      this.onInit();
      this.onInit = null;
    } else {
      this.onUpdate();
    }
  };

  getContainerProps = () => this.actionProps;

  getRegistry() {
    const isLocal = !this.props.scope && !this.props.isGlobal;
    return isLocal ? this.registry : this.state.api.globalRegistry;
  }

  getScopedStore(Store, scopeId = this.props.scope) {
    const { storeType } = this.constructor;
    if (Store !== storeType) {
      return null;
    }
    const { storeState } = this.getRegistry().getStore(Store, scopeId);
    // instead of returning global bound actions
    // we return the ones with the countainer props binding
    return {
      storeState,
      actions: this.state.scopedActions,
    };
  }

  deleteScopedStore(scopeId = this.props.scope) {
    const { storeType } = this.constructor;
    const { storeState } = this.getScopedStore(storeType, scopeId);
    if (!storeState.listeners().length) {
      this.getRegistry().deleteStore(storeType, scopeId);
    }
  }

  render() {
    const { children } = this.props;
    return (
      <Context.Provider value={this.state.api}>{children}</Context.Provider>
    );
  }
}

export function createContainer(
  Store,
  { onInit = noop, onUpdate = noop, displayName = '' } = {}
) {
  return class extends Container {
    static storeType = Store;
    static displayName = displayName || `Container(${Store.key[0]})`;
    static hooks = { onInit, onUpdate };
  };
}
