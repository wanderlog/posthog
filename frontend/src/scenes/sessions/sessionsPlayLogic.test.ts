import { sessionsPlayLogic } from 'scenes/sessions/sessionsPlayLogic'
import { api, defaultAPIMocks, mockAPI } from 'lib/api.mock'
import { expectLogic, initKeaTestLogic } from '~/test/kea-test-utils'
import { sessionsTableLogic } from 'scenes/sessions/sessionsTableLogic'
import { eventUsageLogic, RecordingWatchedSource } from 'lib/utils/eventUsageLogic'
import recordingJson from './__mocks__/recording.json'
import { preflightLogic } from 'scenes/PreflightCheck/logic'
import { combineUrl } from 'kea-router'

jest.mock('lib/api')

describe('sessionsPlayLogic', () => {
    let logic: ReturnType<typeof sessionsPlayLogic.build>

    mockAPI(async (url) => {
        if (
            url.pathname === 'api/event/session_recording' || // Old api
            url.pathname === 'api/projects/@current/session_recordings' // New api
        ) {
            return { result: recordingJson }
        } else if (url.pathname === 'api/sessions_filter') {
            return { results: [] }
        }
        return defaultAPIMocks(url)
    })

    initKeaTestLogic({
        logic: sessionsPlayLogic,
        onLogic: (l) => (logic = l),
    })

    describe('core assumptions', () => {
        it('mounts other logics', async () => {
            await expectLogic(logic).toMount([sessionsTableLogic, eventUsageLogic])
        })
        it('has default values', async () => {
            await expectLogic(logic).toMatchValues({
                sessionRecordingId: null,
                sessionPlayerData: null,
                addingTagShown: false,
                addingTag: '',
                loadingNextRecording: false,
                firstChunkLoaded: false,
                source: RecordingWatchedSource.Unknown,
            })
        })
    })

    describe('loading session data', () => {
        it('no next url', async () => {
            await expectLogic(logic, () => {
                logic.actions.loadRecording('1')
            })
                .toDispatchActions(['loadRecordingSuccess'])
                .toMatchValues({
                    sessionPlayerData: recordingJson,
                    firstChunkLoaded: true,
                })
                .toNotHaveDispatchedActions(['loadRecording'])
        })
        it('fetch all chunks of recording', async () => {
            await expectLogic(preflightLogic).toDispatchActions(['loadPreflightSuccess'])
            await expectLogic(logic).toMount([eventUsageLogic])
            api.get.mockClear()

            const firstNext = `api/event/session_recording?session_recording_id=1&offset=200&limit=200`
            const secondNext = `api/event/session_recording?session_recording_id=1&offset=400&limit=200`
            const thirdNext = `api/event/session_recording?session_recording_id=1&offset=600&limit=200`
            const snaps = recordingJson.snapshots

            api.get
                .mockImplementationOnce(async (url: string) => {
                    if (combineUrl(url).pathname === 'api/event/session_recording') {
                        return { result: { ...recordingJson, next: firstNext } }
                    }
                })
                .mockImplementationOnce(async (url: string) => {
                    if (combineUrl(url).pathname === 'api/event/session_recording') {
                        return { result: { ...recordingJson, next: secondNext } }
                    }
                })
                .mockImplementationOnce(async (url: string) => {
                    if (combineUrl(url).pathname === 'api/event/session_recording') {
                        return { result: { ...recordingJson, next: thirdNext } }
                    }
                })
                .mockImplementationOnce(async (url: string) => {
                    if (combineUrl(url).pathname === 'api/event/session_recording') {
                        return { result: recordingJson }
                    }
                })

            await expectLogic(logic, () => {
                logic.actions.loadRecording('1')
            })
                .toDispatchActions(['loadRecordingSuccess'])
                .toMatchValues({
                    sessionPlayerData: { ...recordingJson, next: firstNext },
                    firstChunkLoaded: true,
                })
                .toDispatchActions([logic.actionCreators.loadRecording(undefined, firstNext), 'loadRecordingSuccess'])
                .toMatchValues({
                    sessionPlayerData: {
                        ...recordingJson,
                        next: secondNext,
                        snapshots: [...snaps, ...snaps],
                    },
                    firstChunkLoaded: true,
                })
                .toDispatchActions([logic.actionCreators.loadRecording(undefined, secondNext), 'loadRecordingSuccess'])
                .toMatchValues({
                    sessionPlayerData: {
                        ...recordingJson,
                        next: thirdNext,
                        snapshots: [...snaps, ...snaps, ...snaps],
                    },
                    firstChunkLoaded: true,
                })
                .toDispatchActions([logic.actionCreators.loadRecording(undefined, thirdNext), 'loadRecordingSuccess'])
                .toMatchValues({
                    sessionPlayerData: {
                        ...recordingJson,
                        next: null,
                        snapshots: [...snaps, ...snaps, ...snaps, ...snaps],
                    },
                    firstChunkLoaded: true,
                })

            expect(api.get).toBeCalledTimes(4)
        })
        it('internal server error mid-way through recording', async () => {
            await expectLogic(preflightLogic).toDispatchActions(['loadPreflightSuccess'])
            await expectLogic(logic).toMount([eventUsageLogic])
            api.get.mockClear()

            const firstNext = `api/event/session_recording?session_recording_id=1&offset=200&limit=200`
            const secondNext = `api/event/session_recording?session_recording_id=1&offset=400&limit=200`
            const snaps = recordingJson.snapshots

            api.get
                .mockImplementationOnce(async (url: string) => {
                    if (combineUrl(url).pathname === 'api/event/session_recording') {
                        return { result: { ...recordingJson, next: firstNext } }
                    }
                })
                .mockImplementationOnce(async (url: string) => {
                    if (combineUrl(url).pathname === 'api/event/session_recording') {
                        return { result: { ...recordingJson, next: secondNext } }
                    }
                })
                .mockImplementationOnce(async () => {
                    throw new Error('Error in third request')
                })

            await expectLogic(logic, () => {
                logic.actions.loadRecording('1')
            })
                .toDispatchActions(['loadRecordingSuccess'])
                .toMatchValues({
                    sessionPlayerData: { ...recordingJson, next: firstNext },
                    firstChunkLoaded: true,
                })
                .toDispatchActions([logic.actionCreators.loadRecording(undefined, firstNext), 'loadRecordingSuccess'])
                .toMatchValues({
                    sessionPlayerData: {
                        ...recordingJson,
                        next: secondNext,
                        snapshots: [...snaps, ...snaps],
                    },
                    firstChunkLoaded: true,
                })
                .toDispatchActions([logic.actionCreators.loadRecording(undefined, secondNext), 'loadRecordingFailure'])

            // Error toast is thrown
            expect(api.get).toBeCalledTimes(3)
        })
    })
})