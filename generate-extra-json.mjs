/**
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {binaries, platforms, makeDownloadUrl} from './url-utils.mjs';
import {
	isOlderVersion,
	predatesChromeDriverAvailability,
	predatesChromeHeadlessShellAvailability,
} from './is-older-version.mjs';
import {readJsonFile, writeJsonFile} from './json-utils.mjs';

const createTimestamp = () => {
	return new Date().toISOString();
};

const prepareLastKnownGoodVersionsData = async (data) => {
	const lastKnownGoodVersions = await readJsonFile('./data/last-known-good-versions.json');
	for (const channelData of Object.values(data.channels)) {
		if (!channelData.ok) continue;
		const channelName = channelData.channel;
		const knownData = lastKnownGoodVersions.channels[channelName];
		if (
			knownData.version === channelData.version &&
			knownData.revision === channelData.revision
		) {
			continue;
		}
		lastKnownGoodVersions.timestamp = createTimestamp();
		knownData.version = channelData.version;
		knownData.revision = channelData.revision;
	}
	return lastKnownGoodVersions;
};

const updateKnownGoodVersions = async (filePath, lastKnownGoodVersions) => {
	const knownGoodVersions = await readJsonFile(filePath);
	const set = new Set();
	const versions = knownGoodVersions.versions;
	for (const entry of versions) {
		set.add(entry.version);
	}
	for (const entry of Object.values(lastKnownGoodVersions.channels)) {
		const {version, revision} = entry;
		if (set.has(version)) {
			continue;
		}
		set.add(version);
		versions.push({
			version,
			revision,
		});
		knownGoodVersions.timestamp = createTimestamp();
	}
	knownGoodVersions.versions.sort((a, b) => {
		if (isOlderVersion(a.version, b.version)) return -1;
		if (a.version === b.version) return 0; // This cannot happen.
		return 1;
	});
	await writeJsonFile(filePath, knownGoodVersions);
	return knownGoodVersions;
};

const addDownloads = (data, key) => {
	const copy = structuredClone(data);
	for (const channelData of Object.values(copy[key])) {
		const downloads = channelData.downloads = {};
		for (const binary of binaries) {
			const version = channelData.version;
			if (binary === 'chromedriver' && predatesChromeDriverAvailability(version)) {
				continue;
			}
			if (binary === 'chrome-headless-shell' && predatesChromeHeadlessShellAvailability(version)) {
				continue;
			}
			if (binary === 'mojojs') {
				// Exclude mojojs from the dashboard + API.
				continue;
			}
			const downloadsForThisBinary = downloads[binary] = [];
			// `mojojs.zip` is platform-agnostic. (This is dead code right now,
			// but it’s useful in case we ever decide to include mojojs in the
			// dashboard + API.)
			if (binary === 'mojojs') {
				const url = makeDownloadUrl({
					version: version,
					binary: binary,
				});
				downloadsForThisBinary.push({
					url: url,
				});
				continue;
			}
			for (const platform of platforms) {
				const url = makeDownloadUrl({
					version: version,
					platform: platform,
					binary: binary,
				});
				downloadsForThisBinary.push({
					platform: platform,
					url: url,
				});
			}
		}
	}
	return copy;
};

const updateLatestVersionsPerMilestone = async (filePath, lastKnownGoodVersionsData) => {
	const latestVersionsPerMilestoneData = await readJsonFile(filePath);
	const milestones = latestVersionsPerMilestoneData.milestones;
	let needsUpdate = false;

	for (const channelData of Object.values(lastKnownGoodVersionsData.channels)) {
		const {version, revision} = channelData;
		const milestone = version.split('.')[0];
		if (Object.hasOwn(milestones, milestone)) {
			const current = milestones[milestone];
			if (isOlderVersion(current.version, version)) {
				needsUpdate = true;
				current.version = version;
				current.revision = revision;
			}
		} else {
			needsUpdate = true;
			milestones[milestone] = {
				milestone,
				version,
				revision,
			};
		}
	}

	if (needsUpdate) {
		latestVersionsPerMilestoneData.timestamp = createTimestamp();
	}

	await writeJsonFile(filePath, latestVersionsPerMilestoneData);
	return latestVersionsPerMilestoneData;
};

const prepareLatestPatchVersionsPerBuild = (knownGoodVersions) => {
	const map = new Map(); // partialVersion → versionInfo
	const re = /(?<build>.*)\.(?<patch>\d+)$/;
	for (const entry of knownGoodVersions.versions) {
		const version = entry.version;
		const match = re.exec(version);
		const {build, patch} = match.groups;
		if (map.has(build)) {
			const knownEntry = map.get(build);
			if (isOlderVersion(knownEntry.version, version)) {
				map.set(build, entry);
			}
		} else {
			map.set(build, entry);
		}
	}
	const result = {
		timestamp: knownGoodVersions.timestamp,
		builds: {},
	};
	const builds = result.builds;
	for (const [partialVersion, entry] of map) {
		builds[partialVersion] = entry;
	}
	return result;
};

const DASHBOARD_DATA = await readJsonFile('./data/dashboard.json');

const lastKnownGoodVersionsData = await prepareLastKnownGoodVersionsData(DASHBOARD_DATA);
await writeJsonFile(
	'./data/last-known-good-versions.json',
	lastKnownGoodVersionsData
);

await writeJsonFile(
	'./data/last-known-good-versions-with-downloads.json',
	addDownloads(lastKnownGoodVersionsData, 'channels')
);

const latestVersionsPerMilestone = await updateLatestVersionsPerMilestone('./data/latest-versions-per-milestone.json', lastKnownGoodVersionsData);

await writeJsonFile(
	'./data/latest-versions-per-milestone-with-downloads.json',
	addDownloads(latestVersionsPerMilestone, 'milestones')
);

const knownGoodVersions = await updateKnownGoodVersions('./data/known-good-versions.json', lastKnownGoodVersionsData);

await writeJsonFile(
	'./data/known-good-versions-with-downloads.json',
	addDownloads(knownGoodVersions, 'versions')
);

const latestPatchVersionsPerBuild = prepareLatestPatchVersionsPerBuild(knownGoodVersions);
await writeJsonFile(
	'./data/latest-patch-versions-per-build.json',
	latestPatchVersionsPerBuild
);

await writeJsonFile(
	'./data/latest-patch-versions-per-build-with-downloads.json',
	addDownloads(latestPatchVersionsPerBuild, 'builds')
);

const writePerVersionFiles = async () => {
  await Promise.all(addDownloads(knownGoodVersions, 'versions').versions.map((release) => {
    const fileName = `./dist/${release.version}.json`;
    return writeJsonFile(fileName, release);
  }));
};

writePerVersionFiles();
