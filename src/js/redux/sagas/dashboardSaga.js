import {
  race,
  call,
  put,
  fork,
  take,
  takeEvery,
  takeLatest,
  cancel,
} from 'redux-saga/effects';
import { Configuration, Device } from 'Services';
import moment from 'moment';
import _ from 'lodash';
import { getUserInformation } from 'Utils';
import {
  constants as dashboardConstants,
  actions as dashboardActions,
} from '../modules/dashboard';

const delay = duration => {
  return new Promise(resolve => {
    setTimeout(() => resolve(true), duration);
  });
};

// TODO: This code will be removed later
// TODO: The backstage will be responsible for the correct formatting
// TODO: The reduceList and convertList functions will be removed
const reduceList = prop => {
  const array = [];
  Object.keys(prop).forEach(list => {
    array.push(
      prop[list].reduce((acc, fItem) => {
        const obj = { ...fItem };
        Object.keys(obj).forEach(item => {
          acc[item] = obj[item];
        });
        return acc;
      }, {}),
    );
  });
  return array;
};

const convertList = prop =>
  _.groupBy(
    prop.map(({ label, valueType, deviceID, value, timestamp }) => ({
      [`${deviceID}${label}`]:
        valueType === 'NUMBER' ? parseFloat(value) : value,
      timestamp: moment(timestamp).format('HH:mm:ss'),
    })),
    item => item.timestamp,
  );

function* pollData(schema) {
  try {
    // TODO: This will be improved
    for (const key in schema) {
      const { getDeviceHistory } = yield Device.getDevicesHistoryParsed(
        schema[key],
      );
      const ret = reduceList(convertList(getDeviceHistory));
      const condition = !!ret;
      if (condition) yield put(dashboardActions.updateValues({ [key]: ret }));
    }
    // TODO: MMake the timing adjustable.
    // For now the timer is set to 15 seconds
    yield call(delay, 15000);
  } catch (error) {
    console.error(error);
    yield put(dashboardActions.errorPolling(error));
  }
}

function* pollDashboard({ payload }) {
  while (true) {
    const { end } = yield race({
      poll: call(pollData, payload),
      end: take(dashboardConstants.STOP_POLLING),
    });
    if (end) {
      yield cancel();
    }
  }
}

function* checkData() {
  const { userName, tenant } = getUserInformation();
  try {
    const { getConfig } = yield Configuration.getDashboardConfig(
      userName,
      tenant,
    );
    const parserObject = JSON.parse(getConfig);
    if (!_.isEmpty(parserObject)) {
      yield put(dashboardActions.restoreData(parserObject));
    }
  } catch (e) {
    console.error(e);
  }
}

function* updateData({ payload: { layout, configs, saga } }) {
  const { userName, tenant } = getUserInformation();
  try {
    if (!_.isEmpty(layout) && !_.isEmpty(configs) && !_.isEmpty(saga)) {
      const exportConfig = JSON.stringify({
        layout,
        configs,
        saga,
      });
      yield Configuration.updateDashboardConfig(userName, tenant, exportConfig);
    }
    yield put(dashboardActions.updateLayout(layout));
  } catch (e) {
    console.error(e);
  }
}

function* watchGetDashboard() {
  yield takeEvery(dashboardConstants.START_POLLING, pollDashboard);
  yield takeLatest(dashboardConstants.CHECK_STATE, checkData);
  yield takeLatest(dashboardConstants.CHANGE_LAYOUT, updateData);
}

export const dashboardSaga = [fork(watchGetDashboard)];
